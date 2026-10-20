import './style.css';
import { h, fmtNum, fmtTime } from '../../web/ui/dom';
import { renderHud, renderLegend, renderRail, type CounterEls } from '../../web/ui/panel';
import { createControls, type Playback } from './claude/ui/controls';
import { createWarehouse, type Selection } from './claude/world/warehouse';
import { playbackEnd } from '../../web/world/state';
import type { Capabilities, RunEntry, RunSnapshot, ReplayBundle } from './contracts';
import { flatten, type AgentNode } from './runtime';
import { DEMAND_PROFILES, previewDemand, stationRole, stationFailures, ROUTING_RULE, DAMAGE_RULE, MISSORT_RULE, type DemandProfile } from './factory-guide';
import { renderNemotronResults } from './nemotron-results';
import { DEMO_RUN, DEMO_STEPS, demoAgent } from './demo-tour';

const $=(id:string)=>document.getElementById(id)!;
const modeText={recorded:'RECORDED',live:'LIVE',simulator:'SIMULATOR',fixture:'SYNTHETIC'};
let snapshot:RunSnapshot|null=null,scope:AgentNode|null=null,selected:Selection|null=null;
let view:'layout'|'agents'='layout',caps:Capabilities|null=null,entries:RunEntry[]=[];
let counters:CounterEls|null=null,version=0,timer:number|undefined;
let demand:DemandProfile|null=null,displayReplay:ReplayBundle|null=null;
let demoIndex:number|null=null,demoBusy=false;
const playback:Playback={t:0,end:1,playing:false,speed:16};

document.querySelector('#app')!.innerHTML=`
<main id="stage"><div id="scene"></div>
<header id="hud"><a class="brand" href="http://localhost:5181/" aria-label="Factory N+1 landing page" title="Back to landing page">Factory N+1</a><div id="mode-badge" class="mode">CONNECTING</div><div id="hud-meta"></div></header>
<nav id="breadcrumbs" aria-label="Agent factory breadcrumbs" hidden></nav>
<div id="empty-scene" hidden>Waiting for the backend's first scored replay…</div>
<div id="legend"></div><footer id="controls"></footer><div id="connection" role="status" hidden></div></main>
<aside id="rail"><section class="run-controls"><div class="run-actions"><label for="run-select">RUN</label><button id="new-run" class="btn">New run</button></div><select id="run-select" aria-label="Select run"></select><div class="run-state"><span id="run-status">Connecting…</span><button id="stop-run" class="btn" hidden>Stop run</button></div><div class="view-switch" role="group" aria-label="Factory view"><button id="layout-view" class="btn active">Factory layouts</button><button id="agents-view" class="btn">Agent factories</button></div></section><section id="demand-guide"></section><section id="inspection" hidden></section><section id="factory-guide"></section><section class="run-summary" id="run-summary"></section><details id="results-details"><summary>Results &amp; agent evidence</summary><div id="metrics-panel"></div></details><section><button id="download" class="btn" disabled>Download run evidence</button></section></aside>
<dialog id="run-dialog"><form id="start-form"><div class="dialog-head"><h2>Start a run</h2><button type="button" class="btn" id="close-run" aria-label="Close new run">Close</button></div><p>Use the existing Factory N+1 backend and fixed fulfillment goal.</p><label for="execution-mode">Execution</label><select id="execution-mode"><option value="simulator">Simulator check · no model calls</option><option value="live">Live agents · $0.50 configured cap</option></select><label for="generations">Agent generations</label><select id="generations"><option>1</option><option>2</option><option>3</option></select><p id="live-reason"></p><label id="paid-consent"><input type="checkbox" id="allow-paid"> Authorize this run's paid calls up to the configured $0.50 cap.</label><p class="small">Live mode allows 40 model calls, with a $0.49 inference budget and $0.01 search reserve. Estimates are not billing receipts.</p><p id="launch-error" role="alert" hidden></p><button class="btn primary" id="launch-run" type="submit">Start simulator check</button></form></dialog>`;

async function api<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{cache:'no-store',...init});const data=await response.json();if(!response.ok)throw new Error(data.error??`Request failed (${response.status})`);return data;}
function message(text:string|null){$('connection').textContent=text;$('connection').hidden=!text;}
function button(text:string,action:()=>void,attrs:Record<string,string>={}){const b=h('button',{class:'btn',...attrs},text);b.onclick=action;return b;}
const world=createWarehouse($('scene'),selection=>{selected=selection;if(selection.type==='agent')enter(selection.node);else renderInspection();$('rail').scrollTop=0;});
const controls=createControls($('controls'),playback,{seek:t=>{playback.t=t;},toggle:()=>{if(playback.t>=playback.end)playback.t=0;playback.playing=!playback.playing;},speed:s=>{playback.speed=s;},camera:p=>world.preset(p)});
$('controls').querySelector('input')!.setAttribute('aria-label','Replay time');
$('controls').querySelector('select')!.setAttribute('aria-label','Replay speed');
renderLegend($('legend'));
const tunePanel=h('details',{id:'nemotron-results'},h('summary',null,'Nemotron fine-tune results'));
const tuneContent=h('div',{id:'nemotron-panel'});tunePanel.append(tuneContent);$('results-details').before(tunePanel);
renderNemotronResults(tuneContent);
const demoStart=button('Guided demo · 6 min',()=>void startGuidedDemo(),{id:'start-demo'});
document.querySelector('.view-switch')!.before(demoStart);
const demoBack=button('Back',()=>moveDemo(-1),{id:'demo-back'});
const demoNext=button('Next',()=>moveDemo(1),{id:'demo-next'});
const demoCoach=h('section',{id:'guided-demo',hidden:true,'aria-label':'Guided demo'},
  h('div',{class:'demo-heading'},h('span',{id:'demo-progress'}),button('Exit demo',stopGuidedDemo)),
  h('h2',{id:'demo-title'}),h('p',{id:'demo-cue'}),
  h('div',{id:'demo-speech',tabindex:'0','aria-label':'What to say','aria-live':'polite'}),
  h('div',{class:'demo-navigation'},h('span',null,'Read aloud · scroll notes if needed'),demoBack,demoNext));
document.body.append(demoCoach);
window.addEventListener('resize',()=>{
  if(demoIndex!==null)requestAnimationFrame(focusDemoTarget);
});
function focusDemoTarget(){
  world.preset('overview',false);
  const target=document.querySelector<HTMLElement>('.demo-focus');
  if(target){
    target.style.scrollMarginTop=target.id==='stage'?'0px':`${document.querySelector('.run-controls')!.getBoundingClientRect().height+14}px`;
    target.scrollIntoView({block:'start',behavior:'instant'});
  }
}

function renderDemo(){
  const active=demoIndex!==null;
  demoCoach.hidden=!active;document.body.classList.toggle('guided-mode',active);
  ($('run-select') as HTMLSelectElement).disabled=active;
  ($('new-run') as HTMLButtonElement).disabled=active;
  demoStart.disabled=active||demoBusy||!entries.some(entry=>entry.id===DEMO_RUN);
  if(demoIndex===null)return;
  const step=DEMO_STEPS[demoIndex];
  $('demo-progress').textContent=`GUIDED DEMO · ${demoIndex+1} / ${DEMO_STEPS.length}`;
  $('demo-title').textContent=step.title;$('demo-cue').textContent=step.cue;
  $('demo-speech').replaceChildren(...step.say.map(text=>h('p',null,text)));
  $('demo-speech').scrollTop=0;
  demoBack.disabled=demoIndex===0;demoNext.textContent=demoIndex===DEMO_STEPS.length-1?'Finish':'Next';
}
function openDemoDetails(selector:string){
  const details=document.querySelector<HTMLDetailsElement>(selector);
  if(!details)throw new Error('This demo panel is unavailable.');
  details.open=true;
}
function showDemoStep(){
  if(demoIndex===null||!snapshot?.replay)return;
  const step=DEMO_STEPS[demoIndex];
  document.querySelectorAll('.demo-focus').forEach(el=>el.classList.remove('demo-focus'));
  view='layout';selected=null;selectDemand(step.profile??null);
  document.querySelectorAll<HTMLDetailsElement>('#rail details').forEach(el=>el.open=false);
  playback.t=step.time==='end'?playback.end:0;playback.speed=16;playback.playing=step.time==='play';controls.sync(playback);
  let target:HTMLElement=$('stage');
  if(step.station){selected={type:'station',side:step.station.side,id:step.station.id};renderInspection();openDemoDetails(`#station-${step.station.detail}`);target=$('inspection');}
  if(step.agentPath){
    const node=demoAgent(snapshot.tree,step.agentPath);
    view='agents';scope=node.children.length?node:node.parent??snapshot.tree;
    selected={type:'agent',node};world.setAgents(scope);renderNavigation();renderInspection();target=$('inspection');
  }
  if(step.panel==='rules'){openDemoDetails('#factory-guide details');target=$('factory-guide');}
  if(step.panel==='demand'){openDemoDetails('#demand-guide details');target=$('demand-guide');}
  if(step.panel==='results'){openDemoDetails('#results-details');target=$('results-details');}
  if(step.panel?.startsWith('critic')||step.panel?.startsWith('optimizer')){
    openDemoDetails('#nemotron-results');const kind=step.panel.startsWith('critic')?'critic':'optimizer';
    if(step.panel.endsWith('-details'))openDemoDetails(`#${kind}-test-details`);
    target=$(`${kind}-result`);
  }
  target.classList.add('demo-focus');renderDemo();
  requestAnimationFrame(focusDemoTarget);
}
async function startGuidedDemo(){
  if(demoBusy)return;demoBusy=true;renderDemo();
  try{
    if(snapshot?.id!==DEMO_RUN)await choose(DEMO_RUN);
    if(snapshot?.id!==DEMO_RUN||!snapshot.replay)throw new Error('The recorded demo run is unavailable.');
    demoIndex=0;showDemoStep();
  }catch(e){demoIndex=null;message((e as Error).message);}
  finally{demoBusy=false;renderDemo();}
}
function moveDemo(delta:number){
  if(demoIndex===null)return;
  if(demoIndex+delta>=DEMO_STEPS.length){stopGuidedDemo();return;}
  demoIndex=Math.max(0,demoIndex+delta);
  try{showDemoStep();}catch(e){stopGuidedDemo();message((e as Error).message);}
}
function stopGuidedDemo(){
  demoIndex=null;playback.playing=false;
  document.querySelectorAll('.demo-focus').forEach(el=>el.classList.remove('demo-focus'));
  document.querySelectorAll<HTMLDetailsElement>('#rail details').forEach(el=>el.open=false);
  renderDemo();view='layout';selected=null;if(snapshot?.replay){selectDemand(null);playback.t=playback.end;controls.sync(playback);}
  requestAnimationFrame(()=>{world.preset('overview',false);$('stage').scrollIntoView({block:'start'});});
}
function link(n:AgentNode){for(const c of n.children){c.parent=n;link(c);}}
function nodes(){return snapshot?flatten(snapshot.tree):[];}
function enter(n:AgentNode){selected={type:'agent',node:n};if(n.children.length){scope=n;view='agents';world.setAgents(n);}renderNavigation();renderInspection();$('rail').scrollTop=0;}
function setView(next:typeof view){view=next;selected=null;if(next==='agents'&&snapshot){scope=snapshot.tree;world.setAgents(scope);}else if(displayReplay){world.setBundle(displayReplay);world.preset('overview',false);}renderNavigation();renderInspection();}
function renderNavigation(){
  const agentView=view==='agents';$('stage').classList.toggle('agent-view',agentView);
  $('layout-view').classList.toggle('active',!agentView);$('agents-view').classList.toggle('active',agentView);
  $('breadcrumbs').hidden=!agentView;$('legend').hidden=agentView;
  $('demand-guide').hidden=agentView;$('factory-guide').hidden=agentView;
  ($('layout-view') as HTMLButtonElement).disabled=!snapshot?.replay;
  if(scope){const path:AgentNode[]=[];let n:AgentNode|undefined=scope;while(n){path.unshift(n);n=n.parent;}
    $('breadcrumbs').replaceChildren(...path.flatMap((item,i)=>[...(i?[h('span',null,'/')]:[]),button(item.id==='factory'?'Agent factories':item.name,()=>enter(item))]));}
  controls.setCloseupLabel(world.closeupTarget());
}
function renderInspection(){
  document.querySelectorAll('.st-label').forEach(el=>el.classList.toggle('station-selected',selected?.type==='station'&&el.getAttribute('aria-label')===`Inspect ${selected.side==='baseline'?'baseline':'champion'} ${selected.id}`));
  const panel=$('inspection');panel.replaceChildren();panel.hidden=!selected&&view==='layout';if(panel.hidden||!snapshot)return;
  panel.append(h('div',{class:'section-heading'},h('h3',null,selected?.type==='station'?'Station inspector':'Agent inspector'),button('Close',()=>{selected=null;setView('layout');},{'aria-label':'Close inspector'})));
  if(selected?.type==='station'){
    const stationId=selected.id;
    const s=displayReplay?.[selected.side],station=s?.layout.stations.find(n=>n.id===stationId),stats=s?.result.metrics.stations[stationId];
    panel.append(h('h2',null,selected.id),h('p',{class:'small'},`${selected.side==='baseline'?'Baseline':'Champion'} · ${station?.kind??'station'}`));
    if(stats)panel.append(h('dl',{class:'station-stats'},...Object.entries({'Processed':stats.processed,'Total wait (sum)':`${fmtNum(stats.totalWait)} s`,'Max queue':stats.maxQueue,'Utilization':`${(stats.utilization*100).toFixed(1)}%`}).flatMap(([key,value])=>[h('dt',null,key),h('dd',null,value)])));
    if(station&&s){
      const role=stationRole(station),failures=stationFailures(station,s.result.trace);
      panel.append(h('p',{class:'measurement-note'},`Full scenario totals · ${displayReplay!.scenario.id}`));
      const operation=h('details',{id:'station-operation'},h('summary',null,'How this station works'),h('h3',null,`${role.name} · ${role.time}`),h('p',null,role.description));
      if(station.kind==='pack')operation.append(h('div',{class:'acceptance'},h('b',null,`Sizes: ${(station.sizes??[]).join(', ')}`),h('b',null,`Destinations: ${(station.zones??[]).join(', ')}`)));
      if(station.kind!=='shipping')operation.append(h('p',{class:'small'},ROUTING_RULE));
      const failuresPanel=h('details',{id:'station-failures'},h('summary',null,`Routing & failure details · ${failures.arrivedDamaged} arrived damaged`));
      if(station.kind==='pack'||station.kind==='sorter')failuresPanel.append(h('div',{class:'failure-counts'},h('span',null,`${failures.fallback} ${station.kind==='pack'?'arrived via fallback':'fallback routes'}`),h('span',null,`${failures.arrivedDamaged} arrived damaged`)));
      if(failures.inbound.length)failuresPanel.append(h('h3',null,'Inbound routes'),...failures.inbound.map(route=>h('div',{class:'inbound-route'},h('b',null,`${route.from} → ${station.id}`),h('span',null,`${route.cells} cells · ${route.cells*2}s · ${route.packages} packages`),h('span',{class:route.cells>12?'route-risk':'small'},route.cells>12?`Over fragile limit · ${route.damagedHere} first damaged on this trip`:'Within fragile distance limit'))));
      failuresPanel.append(h('p',{class:'small'},'Damage is tracked across the journey. Arriving damaged does not mean this station caused it.'));
      panel.append(operation,failuresPanel);
    }
    panel.append(button('Open agent factories',()=>setView('agents')));return;
  }
  const n=selected?.type==='agent'?selected.node:scope??snapshot.tree;
  panel.append(h('h2',null,n.name),h('p',{class:'small'},`${n.role} · ${n.model}`),h('span',{class:`state state-${n.status}`},n.status==='idle'?'Not invoked / not yet recorded':n.status==='done'?'Recorded result':n.status),h('p',{class:'node-output'},n.output||n.task));
  if(n.children.length)panel.append(h('h3',null,`${n.children.length} child entries`),h('div',{class:'child-list'},...n.children.map(child=>button(`${child.name} · ${child.role}${child.children.length?' ↗':''}`,()=>enter(child),{'data-node':child.id}))));
  const ids=new Set(flatten(n).map(c=>c.id)),events=snapshot.events.filter(e=>ids.has(e.nodeId));
  if(events.length){const details=h('details',null,h('summary',null,`Recorded events (${events.length})`),...events.map(e=>h('p',{class:'small'},`${fmtTime(e.time)} · ${e.agent}: ${e.message}`)));panel.append(details);}
  panel.append(h('p',{class:'small'},'These are backend roles, proposals, tools and checks. The floor arranges records for navigation; it is not a simulated fulfillment layout.'));
}
function renderGuide(){
  const root=$('demand-guide'),wasOpen=root.querySelector('details')?.open??false;
  const panel=h('div',{class:'demand-detail'});root.replaceChildren();if(!displayReplay)return;
  const profile=DEMAND_PROFILES.find(p=>p.id===displayReplay!.scenario.profile),traces=displayReplay.baseline.result.trace;
  const options=DEMAND_PROFILES.map(p=>button(p.name,()=>selectDemand(p.id),{'aria-pressed':String(demand===p.id),class:`btn ${demand===p.id?'active':''}`}));
  panel.append(h('h3',null,'Explore demand'),h('div',{class:'demand-tabs',role:'group','aria-label':'Demand scenario'},button('Run replay',()=>selectDemand(null),{'aria-pressed':String(demand===null),class:`btn ${demand===null?'active':''}`}),...options),h('p',{class:'scenario-note'},demand?'Simulator preview · saved layouts · no model calls':'Recorded scenario · original run evidence'),h('p',{class:'profile-description'},profile?.description??`Recorded ${displayReplay.scenario.profile} demand.`),h('div',{class:'demand-stats'},h('span',null,h('b',null,String(traces.length)),' packages'),h('span',null,h('b',null,profile?.window??'—'),' arrival window'),h('span',null,h('b',null,String(traces.filter(t=>t.fragile).length)),' fragile')));
  if(profile)panel.append(h('p',{class:'small'},`${profile.fragile} fragile probability; actual count varies by seed. Scenario ${displayReplay.scenario.id}.`));
  panel.append(h('p',{class:'package-mix'},`Package sizes: ${(['S','M','L'] as const).map(size=>`${size} ${traces.filter(t=>t.size===size).length}`).join(' · ')}`));
  root.append(h('details',{open:wasOpen},h('summary',null,`${profile?.name??displayReplay.scenario.profile} demand · ${traces.length} packages`),panel));
  if(!$('factory-guide').childElementCount)$('factory-guide').append(h('div',{class:'process-flow'},...(['receiving','sorter','pack','shipping'] as const).map((kind,i)=>button(`${i+1}. ${kind==='receiving'?'Receive':kind==='sorter'?'Sort':kind==='pack'?'Pack':'Ship'}`,()=>{const station=displayReplay?.improved.layout.stations.find(s=>s.kind===kind);if(station){selected={type:'station',side:'improved',id:station.id};renderInspection();$('rail').scrollTop=0;}}))),h('details',null,h('summary',null,'How sorting & damage work'),h('p',null,MISSORT_RULE),h('p',null,DAMAGE_RULE),h('p',{class:'small'},'White outline = fragile · red = damaged · amber flash = mis-sort. These are deterministic simulation rules.')),h('p',{class:'measurement-note'},'Click a station for stats. Expand its details to inspect routing and failures.'));
}
function selectDemand(next:DemandProfile|null){
  if(!snapshot?.replay)return;demand=next;displayReplay=next?previewDemand(snapshot.replay,next):snapshot.replay;
  playback.t=0;playback.playing=false;playback.end=playbackEnd(displayReplay.baseline.result.trace,displayReplay.improved.result.trace);controls.setEnd(playback.end);
  world.setBundle(displayReplay);renderData();renderInspection();renderNavigation();
}
function renderData(){
  if(!snapshot)return;
  $('mode-badge').textContent=modeText[snapshot.mode];$('mode-badge').className=`mode mode-${snapshot.mode==='fixture'?'synthetic':snapshot.mode==='live'?'live':'recorded'}`;
  $('run-status').textContent=snapshot.state==='running'?snapshot.activePhase:snapshot.state==='error'?'Stopped / error':`Complete · ${snapshot.generations} generation${snapshot.generations===1?'':'s'}`;
  const option=Array.from(($('run-select') as HTMLSelectElement).options).find(o=>o.value===snapshot!.id);if(option)option.textContent=`${snapshot.id} · ${modeText[snapshot.mode].toLowerCase()}`;
  $('stop-run').hidden=snapshot.state!=='running'||!snapshot.id.startsWith('ui-');
  $('empty-scene').hidden=!!snapshot.replay||view==='agents';
  ($('download') as HTMLButtonElement).disabled=!snapshot.replay;
  if(displayReplay){
    const replay={...displayReplay,mode:(snapshot.state==='running'?'live':snapshot.mode==='fixture'?'synthetic':'recorded') as 'live'|'synthetic'|'recorded'};
    renderHud($('mode-badge'),$('hud-meta'),replay);$('mode-badge').textContent=modeText[snapshot.mode];
    if(demand){$('mode-badge').textContent='SIMULATOR PREVIEW';$('mode-badge').className='mode mode-recorded';$('mode-badge').title='Same saved layouts, recomputed locally with the real simulator. No model calls.';}
    const scroll=$('rail').scrollTop;counters=renderRail($('metrics-panel'),replay);$('rail').scrollTop=scroll;
    if(demand)$('metrics-panel').prepend(h('p',{class:'measurement-note'},'Scenario rows and playback show this simulator preview. Validation scores, edits, lessons and model usage below belong to the original recorded run.'));
    const usage=replay.usage,total=usage.usd+usage.searchUsd;
    $('run-summary').replaceChildren(h('div',{class:'goal-line'},h('span',null,'Validation goal'),h('strong',{class:replay.improved.select.dodPassed?'pass':'fail'},replay.improved.select.dodPassed?'PASS':'NOT MET')),h('div',{class:'small'},`${usage.calls} model calls · ${usage.searches} searches · $${total.toFixed(4)} estimated`),...(snapshot.reservedUsd?[h('div',{class:'small'},`$${snapshot.reservedUsd.toFixed(4)} additionally reserved for unknown billing`)]:[]));
  }else{$('hud-meta').textContent=snapshot.tree.output;$('metrics-panel').replaceChildren(h('p',{class:'empty'},'The backend has not written its first scored replay yet.'));$('run-summary').replaceChildren();counters=null;}
  renderGuide();renderDemo();if(snapshot.error)message(snapshot.error);
}
function apply(data:RunSnapshot){
  if(snapshot?.id===data.id&&snapshot.revision===data.revision)return;
  const isNew=snapshot?.id!==data.id,scopeId=scope?.id,selectedId=selected?.type==='agent'?selected.node.id:null;
  const previousReplay=snapshot?.replay;link(data.tree);snapshot=data;
  if(isNew){playback.t=0;selected=null;scope=data.tree;view='layout';demand=null;}
  else{scope=nodes().find(n=>n.id===scopeId)??data.tree;if(selectedId){const node=nodes().find(n=>n.id===selectedId);selected=node?{type:'agent',node}:null;}}
  displayReplay=data.replay?(demand?previewDemand(data.replay,demand):data.replay):null;
  if(view==='agents'&&scope)world.setAgents(scope);else if(displayReplay&&previousReplay!==data.replay){world.setBundle(displayReplay);if(isNew)world.preset('overview',false);}
  playback.end=displayReplay?Math.max(1,playbackEnd(displayReplay.baseline.result.trace,displayReplay.improved.result.trace)):1;playback.t=Math.min(playback.t,playback.end);controls.setEnd(playback.end);
  renderNavigation();renderData();renderInspection();
}
async function choose(id:string){const v=++version;window.clearTimeout(timer);try{const data=await api<RunSnapshot>(`/api/runs/${encodeURIComponent(id)}`);if(v!==version)return;apply(data);message(data.error);const url=new URL(location.href);url.searchParams.set('run',id);history.replaceState(null,'',url);($('run-select') as HTMLSelectElement).value=id;}catch(e){if(v===version)message((e as Error).message);}finally{if(v===version)timer=window.setTimeout(()=>void refresh(id,v),1000);}}
async function refresh(id:string,v:number){try{const data=await api<RunSnapshot>(`/api/runs/${encodeURIComponent(id)}`);if(v!==version)return;apply(data);message(data.error);}catch(e){if(v===version)message(`Connection interrupted. Showing last confirmed data. ${(e as Error).message}`);}finally{if(v===version)timer=window.setTimeout(()=>void refresh(id,v),snapshot?.state==='running'?1000:4000);}}
async function loadList(){entries=(await api<{runs:RunEntry[]}>('/api/runs')).runs;($('run-select') as HTMLSelectElement).replaceChildren(...entries.map(r=>h('option',{value:r.id},`${r.id} · ${modeText[r.mode].toLowerCase()}`)));if(snapshot)($('run-select') as HTMLSelectElement).value=snapshot.id;}
function paintDialog(){const live=($('execution-mode') as HTMLSelectElement).value==='live';$('live-reason').textContent=live?caps?.liveReason??'Checking connection…':'Runs the original simulator and code heuristic. No model calls.';$('paid-consent').hidden=!live;($('generations') as HTMLSelectElement).disabled=!live;($('launch-run') as HTMLButtonElement).disabled=!caps?.backendAvailable||(live&&(!caps.liveReady||!($('allow-paid') as HTMLInputElement).checked));$('launch-run').textContent=live?'Run live agents · $0.50 cap':'Start simulator check';}
$('new-run').onclick=async()=>{try{caps=await api<Capabilities>('/api/capabilities');($('allow-paid') as HTMLInputElement).checked=false;$('launch-error').hidden=true;paintDialog();($('run-dialog') as HTMLDialogElement).showModal();}catch(e){message((e as Error).message);}};
$('close-run').onclick=()=>($('run-dialog') as HTMLDialogElement).close();$('execution-mode').onchange=paintDialog;$('allow-paid').onchange=paintDialog;
$('start-form').onsubmit=async e=>{e.preventDefault();($('launch-run') as HTMLButtonElement).disabled=true;try{const {id}=await api<{id:string}>('/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:($('execution-mode') as HTMLSelectElement).value,generations:Number(($('generations') as HTMLSelectElement).value),allowPaid:($('allow-paid') as HTMLInputElement).checked})});($('run-dialog') as HTMLDialogElement).close();await loadList();await choose(id);}catch(e){$('launch-error').textContent=(e as Error).message;$('launch-error').hidden=false;paintDialog();}};
$('stop-run').onclick=async()=>{if(!snapshot)return;try{await api(`/api/runs/${snapshot.id}/stop`,{method:'POST'});}catch(e){message((e as Error).message);}};
$('run-select').onchange=()=>void choose(($('run-select') as HTMLSelectElement).value);
$('layout-view').onclick=()=>setView('layout');$('agents-view').onclick=()=>setView('agents');
$('download').onclick=()=>{if(!snapshot)return;const blob=new Blob([JSON.stringify({id:snapshot.id,mode:snapshot.mode,replay:snapshot.replay,scenarioPreview:demand?{mode:'simulated',profile:demand,scenario:displayReplay?.scenario,baseline:displayReplay?.baseline.result,improved:displayReplay?.improved.result}:null,events:snapshot.events,reservedUsd:snapshot.reservedUsd,checks:snapshot.checks},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=h('a',{href:url,download:`${snapshot.id}-evidence.json`});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&view==='agents'&&!document.querySelector('dialog[open]')){if(scope?.parent)enter(scope.parent);else setView('layout');}});
let last=performance.now(),lastUi=0;
function tick(now:number){const dt=Math.min(.1,(now-last)/1000);last=now;if(playback.playing&&snapshot?.replay)playback.t=Math.min(playback.end,playback.t+dt*playback.speed);const frames=world.render(playback.t,now/1000);if(now-lastUi>100){lastUi=now;controls.sync(playback);if(frames){const [a,b]=frames;world.setCounters(`shipped ${a.shipped}/${a.views.length} · queue ${a.queued} · damaged ${a.damaged}`,`shipped ${b.shipped}/${b.views.length} · queue ${b.queued} · damaged ${b.damaged}`);counters?.update(a,b);}}requestAnimationFrame(tick);}
requestAnimationFrame(tick);
void(async()=>{try{caps=await api<Capabilities>('/api/capabilities');await loadList();const id=new URLSearchParams(location.search).get('run')??entries.find(r=>r.id==='live-a-5')?.id??entries[0]?.id;if(id)await choose(id);else message('No runs found. Start a simulator check.');}catch(e){message((e as Error).message);}})();
