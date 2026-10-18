import './style.css';
import { h, fmtNum, fmtTime } from './ui/dom';
import { renderHud, renderLegend, renderRail, type CounterEls } from './ui/panel';
import { createControls, type Playback } from './ui/controls';
import { createWarehouse, type Selection } from './world/warehouse';
import { playbackEnd } from './world/state';
import type { BackendEvent, Experiment, RunEntry, RunSnapshot, ReplayBundle } from './contracts';
import { buildSnapshot, parseLines } from './snapshot';
import { flatten, type AgentNode } from './runtime';
import { DEMAND_PROFILES, previewDemand, stationRole, stationFailures, ROUTING_RULE, DAMAGE_RULE, MISSORT_RULE, type DemandProfile } from './factory-guide';
import { renderNemotronGuide, renderNemotronResults } from './nemotron-results';
import type { DemoStep } from './demo-tour';
import { loadVisualInspection, renderVisualInspection, type InspectionState } from './ui/visual-inspection';

const $=(id:string)=>document.getElementById(id)!;
const modeText={recorded:'RECORDED',live:'LIVE',simulator:'SIMULATOR',fixture:'SYNTHETIC'};
let snapshot:RunSnapshot|null=null,scope:AgentNode|null=null,selected:Selection|null=null;
let view:'layout'|'agents'|'visual'='layout',entries:RunEntry[]=[],artifacts:Record<string,string[]>={};
let visualInspection:InspectionState={status:'loading',runId:'live-a-11'};
let counters:CounterEls|null=null,version=0,pinnedFrame='';
let guide:{refresh():void}|null=null;
let demand:DemandProfile|null=null,displayReplay:ReplayBundle|null=null;
const playback:Playback={t:0,end:1,playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,speed:16};

document.querySelector('#app')!.innerHTML=`
<main id="stage"><div id="scene"></div>
<header id="hud"><a class="brand" href="./">Factory N+1</a><div id="mode-badge" class="mode">LOADING</div><div id="hud-meta"></div></header>
<nav id="breadcrumbs" aria-label="Agent factory breadcrumbs" hidden></nav>
<div id="empty-scene" hidden>Loading recorded simulator traces…</div>
<div id="frame-tag" hidden></div><div id="legend"></div><footer id="controls"></footer><div id="connection" role="status" hidden></div></main>
<aside id="rail"><section class="run-controls"><div class="run-actions"><label for="run-select">RUN</label><a href="./" class="btn">Back to proof</a></div><select id="run-select" aria-label="Select run"></select><div class="run-state"><span id="run-status">Loading recording…</span></div><div class="view-switch" role="group" aria-label="Factory view"><button id="layout-view" class="btn active">Factory layouts</button><button id="agents-view" class="btn">Agent factories</button><button id="visual-view" class="btn">Visual inspector</button></div></section><section id="visual-inspection" hidden></section><section id="inspection" hidden></section><details id="operator-controls" class="more" hidden><summary>Operator controls</summary><div id="operator-content"></div></details><section class="run-summary" id="run-summary"></section><div id="metrics-panel"></div><details id="learn-factory" class="more"><summary>Factory guide · stations &amp; demand</summary><section id="factory-guide"></section><section id="demand-guide"></section></details><details class="more" id="nemotron-models"><summary>Why we used Nemotron · model guide</summary><div id="nemotron-guide"></div></details><details class="more" id="nemotron-results"><summary>Nemotron fine-tune results</summary><div id="nemotron-panel"></div></details><section class="artifact-links" id="run-evidence"></section><section><button id="download" class="btn" disabled>Download run evidence</button></section></aside>
`;

const imageCheck = new URLSearchParams(location.search).get('visionCheck');
if (imageCheck && /^[A-Z0-9]{1,12}$/.test(imageCheck)) {
  $('stage').append(h('div', { class: 'vision-check', 'aria-label': 'Image input verification marker' }, `IMAGE CHECK: ${imageCheck}`));
}

async function json<T>(url:string):Promise<T>{const response=await fetch(url);if(!response.ok)throw new Error(`Could not load ${url} (${response.status})`);return response.json();}
async function lines<T>(url:string):Promise<T[]>{const response=await fetch(url);return response.ok?parseLines<T>(await response.text()):[];}
function message(text:string|null){$('connection').textContent=text;$('connection').hidden=!text;}
function button(text:string,action:()=>void,attrs:Record<string,string>={}){const b=h('button',{class:'btn',...attrs},text);b.onclick=action;return b;}
$('metrics-panel').after($('operator-controls'));
renderNemotronResults($('nemotron-panel'));
renderNemotronGuide($('nemotron-guide'));
const world=createWarehouse($('scene'),selection=>{selected=selection;if(selection.type==='agent')enter(selection.node);else renderInspection();$('rail').scrollTop=0;});
const controls=createControls($('controls'),playback,{seek:t=>{playback.t=t;},toggle:()=>{if(playback.t>=playback.end)playback.t=0;playback.playing=!playback.playing;},speed:s=>{playback.speed=s;},camera:p=>world.preset(p)});
$('controls').querySelector('input')!.setAttribute('aria-label','Replay time');
$('controls').querySelector('select')!.setAttribute('aria-label','Replay speed');
renderLegend($('legend'));
function link(n:AgentNode){for(const c of n.children){c.parent=n;link(c);}}
function nodes(){return snapshot?flatten(snapshot.tree):[];}
function enter(n:AgentNode){selected={type:'agent',node:n};if(n.children.length){scope=n;view='agents';world.setAgents(n);}const url=new URL(location.href);url.searchParams.set('view','agents');url.searchParams.set('node',n.id);history.replaceState(null,'',url);renderNavigation();renderInspection();$('rail').scrollTop=0;}
function setView(next:typeof view){view=next;selected=null;const url=new URL(location.href);url.searchParams.set('view',next);url.searchParams.delete('node');history.replaceState(null,'',url);if(next==='agents'&&snapshot){scope=snapshot.tree;world.setAgents(scope);}else if(displayReplay){world.setBundle(displayReplay);world.preset('overview',false);}renderNavigation();renderInspection();}
function renderNavigation(){
  const agentView=view==='agents';$('stage').classList.toggle('agent-view',agentView);
  $('layout-view').classList.toggle('active',view==='layout');$('agents-view').classList.toggle('active',agentView);$('visual-view').classList.toggle('active',view==='visual');
  $('app').classList.toggle('visual-view',view==='visual');
  $('visual-inspection').hidden=view!=='visual';
  if(view==='visual')renderVisualInspection($('visual-inspection'),visualInspection,seconds=>{playback.t=Math.max(0,Math.min(playback.end,seconds));playback.playing=false;});
  // In the inspector, freeze the floor on the exact frame Nemotron was shown, once per visit.
  const frame=visualInspection.status==='ready'?visualInspection.data.frames.find(f=>f.simulationTime!==undefined):undefined;
  if(view!=='visual')pinnedFrame='';
  else if(frame&&pinnedFrame!==visualInspection.runId){pinnedFrame=visualInspection.runId;playback.t=Math.max(0,Math.min(playback.end,frame.simulationTime!));playback.playing=false;world.preset('overview');}
  $('frame-tag').hidden=view!=='visual'||!frame;
  if(frame)$('frame-tag').textContent=`Frozen on the frame Nemotron saw · sim t ${fmtTime(frame.simulationTime!)}`;
  $('breadcrumbs').hidden=!agentView;$('legend').hidden=agentView;
  ($('layout-view') as HTMLButtonElement).disabled=!snapshot?.replay;
  if(scope){const path:AgentNode[]=[];let n:AgentNode|undefined=scope;while(n){path.unshift(n);n=n.parent;}
    $('breadcrumbs').replaceChildren(...path.flatMap((item,i)=>[...(i?[h('span',null,'/')]:[]),button(item.id==='factory'?'Agent factories':item.name,()=>enter(item))]));}
  controls.setCloseupLabel(world.closeupTarget());
}
function renderInspection(){
  document.querySelectorAll('.st-label').forEach(el=>el.classList.toggle('station-selected',selected?.type==='station'&&el.getAttribute('aria-label')===`Inspect ${selected.side==='baseline'?'baseline':'champion'} ${selected.id}`));
  const panel=$('inspection');panel.replaceChildren();panel.hidden=view==='visual'||(!selected&&view==='layout');if(panel.hidden||!snapshot)return;
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
  panel.append(h('p',{class:'small'},'These are recorded roles, proposals, tools and checks. The floor arranges records for navigation; it is not a simulated fulfillment layout.'));
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
  $('factory-guide').querySelector('.station-directory')?.remove();
  const directory=h('details',{class:'station-directory'},h('summary',null,'Choose a station'));
  const select=h('select',{'aria-label':'Choose a factory station'},h('option',{value:''},'Select a station to inspect'));
  for(const side of ['baseline','improved'] as const){
    const group=h('optgroup',{label:side==='baseline'?'Before':'After'});
    for(const station of displayReplay[side].layout.stations)group.append(h('option',{value:`${side}:${station.id}`},`${stationRole(station).name} · ${station.id}`));
    select.append(group);
  }
  select.onchange=()=>{if(!select.value)return;const [side,id]=select.value.split(':');selected={type:'station',side:side as 'baseline'|'improved',id};renderInspection();$('inspection').scrollIntoView({block:'start'});};
  directory.append(select);$('factory-guide').append(directory);

}
function selectDemand(next:DemandProfile|null){
  if(!snapshot?.replay)return;demand=next;displayReplay=next?previewDemand(snapshot.replay,next):snapshot.replay;
  playback.t=0;playback.playing=false;playback.end=playbackEnd(displayReplay.baseline.result.trace,displayReplay.improved.result.trace);controls.setEnd(playback.end);
  if(view==='agents'&&scope)world.setAgents(scope);else world.setBundle(displayReplay);renderData();renderInspection();renderNavigation();
}
function renderData(){
  if(!snapshot)return;
  $('mode-badge').textContent=modeText[snapshot.mode];$('mode-badge').className=`mode mode-${snapshot.mode==='fixture'?'synthetic':snapshot.mode==='live'?'live':'recorded'}`;
  $('run-status').textContent=snapshot.state==='running'?`Live · ${snapshot.generations} generation${snapshot.generations===1?'':'s'} scored so far${resumeNote} · refreshing every 2 s`:snapshot.generations?`Complete · ${snapshot.generations} recorded generations${resumeNote}`:'Recorded comparison';
  const option=Array.from(($('run-select') as HTMLSelectElement).options).find(o=>o.value===snapshot!.id);if(option)option.textContent=`${snapshot.id} · ${modeText[snapshot.mode].toLowerCase()}`;
  $('empty-scene').hidden=!!snapshot.replay||view==='agents';
  ($('download') as HTMLButtonElement).disabled=!snapshot.replay;
  renderGuide();
  if(displayReplay){
    const replay={...displayReplay,mode:(snapshot.state==='running'?'live':snapshot.mode==='fixture'?'synthetic':'recorded') as 'live'|'synthetic'|'recorded'};
    renderHud($('mode-badge'),$('hud-meta'),replay);$('mode-badge').textContent=demand?'SIMULATOR PREVIEW':modeText[snapshot.mode];
    if(demand)$('mode-badge').title='Saved layouts, simulated locally. No model calls.';
    const scroll=$('rail').scrollTop;counters=renderRail($('metrics-panel'),replay);$('rail').scrollTop=scroll;
    if(demand)$('metrics-panel').prepend(h('p',{class:'measurement-note'},'Simulator preview: day results and playback are recomputed. Validation scores and the timeline remain the original recorded evidence.'));
    const usage=replay.usage,total=usage.usd+usage.searchUsd;
    $('run-summary').replaceChildren(h('div',{class:'goal-line'},h('span',null,replay.improved.final?'Shared memory: final goal':'Validation goal'),h('strong',{class:(replay.improved.final?.dodPassed??replay.improved.select.dodPassed)?'pass':'fail'},(replay.improved.final?.dodPassed??replay.improved.select.dodPassed)?'PASS':'NOT MET')),h('div',{class:'small'},`${usage.calls} model calls · ${usage.searches} searches · $${total.toFixed(4)} estimated`),...(snapshot.reservedUsd?[h('div',{class:'small'},`$${snapshot.reservedUsd.toFixed(4)} additionally reserved for unknown billing`)]:[]));
  }else{$('hud-meta').textContent=snapshot.tree.output;$('metrics-panel').replaceChildren(h('p',{class:'empty'},'No scored replay exists in this recording.'));$('run-summary').replaceChildren();counters=null;}
  if(snapshot.error)message(snapshot.error);
}
function apply(data:RunSnapshot){
  if(snapshot?.id===data.id&&snapshot.revision===data.revision)return;
  const isNew=snapshot?.id!==data.id,scopeId=scope?.id,selectedId=selected?.type==='agent'?selected.node.id:null;
  const previousReplay=snapshot?.replay;link(data.tree);snapshot=data;
  if(isNew){playback.t=0;selected=null;scope=data.tree;view='layout';demand=null;}
  else{scope=nodes().find(n=>n.id===scopeId)??data.tree;if(selectedId){const node=nodes().find(n=>n.id===selectedId);selected=node?{type:'agent',node}:null;}}
  displayReplay=data.replay?(demand?previewDemand(data.replay,demand):data.replay):null;
  if(view==='agents'&&scope)world.setAgents(scope);else if(data.replay&&previousReplay!==data.replay){world.setBundle(displayReplay!);if(isNew)world.preset('overview',false);}
  playback.end=displayReplay?Math.max(1,playbackEnd(displayReplay.baseline.result.trace,displayReplay.improved.result.trace)):1;playback.t=Math.min(playback.t,playback.end);controls.setEnd(playback.end);
  renderNavigation();renderData();renderInspection();guide?.refresh();
}
/** Fetch one run. Live runs grow while we watch, so every file is optional and fetched fresh. */
async function fetchRun(id:string){
  const base=`./runs/${encodeURIComponent(id)}`;
  const available=artifacts[id]??['replay.json'];
  const live=/^live-demo-\d+$/.test(id);
  const has=(name:string)=>live||available.includes(name);
  const optional=async<T>(url:string)=>{const r=await fetch(url,{cache:'no-store'});return r.ok?(await r.json()) as T:null;};
  const [replay,events,experiments,summary]=await Promise.all([
    json<ReplayBundle>(`${base}/replay.json`),has('events.jsonl')?lines<BackendEvent>(`${base}/events.jsonl`):[],has('experiments.jsonl')?lines<Experiment>(`${base}/experiments.jsonl`):[],
    has('summary.json')?optional<{runId:string;stopReason?:string;usage?:{calls:number;usd:number;reservedUsd?:number}}>(`${base}/summary.json`):null
  ]);
  // Live runs started on this machine keep a launch record beside the run; it lists any resumes.
  const record=live?await optional<{resumes?:{fromGeneration:number}[]}>(`./runs/${encodeURIComponent(id)}.live.json`).catch(()=>null):null;
  const r=record?.resumes?.at(-1);resumeNote=r?` · resumed from gen ${r.fromGeneration}`:'';
  return buildSnapshot(id,replay,events,experiments,summary);
}
let pollTimer:ReturnType<typeof setTimeout>|undefined;
let resumeNote='';
/** While the loaded run is live, re-fetch it every 2 s. apply() keeps the camera, view and selection. */
function poll(id:string){
  clearTimeout(pollTimer);
  if(snapshot?.id!==id||snapshot.state!=='running')return;
  pollTimer=setTimeout(async()=>{const v=version;try{const data=await fetchRun(id);if(v===version)apply(data);}catch{/* keep the last good frame */}poll(id);},2000);
}
async function choose(id:string){
  const v=++version;message(null);clearTimeout(pollTimer);
  visualInspection={status:'loading',runId:id};
  void loadVisualInspection(id).then(result=>{if(v!==version)return;visualInspection=result;if(view==='visual')renderNavigation();});
  try{
    const base=`./runs/${encodeURIComponent(id)}`;
    const available=artifacts[id]??['replay.json'];
    const data=await fetchRun(id);
    if(v!==version)return;
    apply(data);
    poll(id);
    const url=new URL(location.href);url.searchParams.set('run',id);history.replaceState(null,'',url);
    ($('run-select') as HTMLSelectElement).value=id;
    const params=new URLSearchParams(location.search);const requested=params.get('view');const nodeId=params.get('node');if(requested==='agents'||requested==='visual')setView(requested);
    const target=nodeId?nodes().find(n=>n.id===nodeId):null;if(target)enter(target);
    $('run-evidence').replaceChildren(...available.filter(file=>['replay.json','summary.json','events.jsonl','experiments.jsonl'].includes(file)).map(file=>h('a',{href:`${base}/${file}`,target:'_blank',rel:'noopener'},file)));
  }catch(e){message((e as Error).message);}
}
async function loadList(){
  const catalog=await json<{runs:string[];artifacts:Record<string,string[]>}>('./runs/index.json');
  artifacts=catalog.artifacts;
  entries=catalog.runs.map(id=>({id,mode:id==='sample'?'fixture':'recorded',state:'complete',createdAt:''}));
  ($('run-select') as HTMLSelectElement).replaceChildren(...entries.map(r=>h('option',{value:r.id},`${r.id} · ${modeText[r.mode].toLowerCase()}`)));
}
// Presenter tours: always on locally; on the public site only with ?tour in the URL.
if(import.meta.env.DEV||new URLSearchParams(location.search).has('tour'))void Promise.all([import('./ui/guided-demo'),import('./demo-tour')]).then(([{mountGuidedDemo},{DEMO_RUN,demoAgent}])=>{
guide=mountGuidedDemo(document.querySelector('.view-switch')!,{
  ready:()=>entries.some(r=>r.id===DEMO_RUN),
  load:async()=>{if(snapshot?.id!==DEMO_RUN)await choose(DEMO_RUN);if(snapshot?.id!==DEMO_RUN||!snapshot.replay)throw new Error('Run 11 is unavailable.');},
  lock:active=>{($('run-select') as HTMLSelectElement).disabled=active;$('operator-content').inert=active;},
  show:showDemoStep,
  reset:()=>{document.querySelectorAll('#rail details').forEach(el=>(el as HTMLDetailsElement).open=false);setView('layout');selectDemand(null);playback.t=playback.end;playback.playing=false;controls.sync(playback);$('rail').scrollTop=0;requestAnimationFrame(()=>{$('stage').scrollIntoView({block:'start'});});},
  error:text=>message(text),
});
function showDemoStep(step:DemoStep){
  view='layout';selected=null;selectDemand(step.profile??null);
  document.querySelectorAll<HTMLDetailsElement>('#rail details').forEach(el=>el.open=false);
  playback.t=step.time==='end'?playback.end:0;playback.speed=16;playback.playing=step.time==='play';controls.sync(playback);
  let target:HTMLElement=$('stage');
  const open=(selector:string)=>{const el=document.querySelector<HTMLDetailsElement>(selector);if(!el)throw new Error(`Demo panel missing: ${selector}`);el.open=true;return el;};
  if(step.station){selected={type:'station',side:step.station.side,id:step.station.id};renderInspection();open(`#station-${step.station.detail}`);target=$('inspection');}
  if(step.agentPath){const node=demoAgent(snapshot!.tree,step.agentPath);view='agents';scope=node.children.length?node:node.parent??snapshot!.tree;selected={type:'agent',node};world.setAgents(scope);renderNavigation();renderInspection();target=$('inspection');}
  if(step.panel==='rules'){open('#learn-factory');open('#factory-guide details');target=$('factory-guide');}
  if(step.panel==='demand'){open('#learn-factory');open('#demand-guide details');target=$('demand-guide');}
  if(step.panel==='score'){open('.result .score-explainer');target=document.querySelector<HTMLElement>('.result')!;}
  if(step.panel==='results')target=document.querySelector<HTMLElement>('.result')!;
  if(step.panel==='work')target=document.querySelector<HTMLElement>('.work')!;
  if(step.panel?.startsWith('critic')||step.panel?.startsWith('optimizer')){open('#nemotron-results');const kind=step.panel.startsWith('critic')?'critic':'optimizer';if(step.panel.endsWith('-details'))open(`#${kind}-test-details`);target=$(`${kind}-result`);}
  document.querySelectorAll('.demo-focus').forEach(el=>el.classList.remove('demo-focus'));target.classList.add('demo-focus');
  requestAnimationFrame(()=>{world.preset('overview',false);target.style.scrollMarginTop='14px';target.scrollIntoView({block:'start',behavior:'instant'});});
}
});
$('run-select').onchange=()=>void choose(($('run-select') as HTMLSelectElement).value);
$('layout-view').onclick=()=>setView('layout');$('agents-view').onclick=()=>setView('agents');$('visual-view').onclick=()=>setView('visual');
$('download').onclick=()=>{if(!snapshot)return;const blob=new Blob([JSON.stringify({id:snapshot.id,mode:snapshot.mode,replay:snapshot.replay,events:snapshot.events,reservedUsd:snapshot.reservedUsd,checks:snapshot.checks},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=h('a',{href:url,download:`${snapshot.id}-evidence.json`});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&view==='agents'&&!document.querySelector('dialog[open]')){if(scope?.parent)enter(scope.parent);else setView('layout');}});
let last=performance.now(),lastUi=0;
function tick(now:number){const dt=Math.min(.1,(now-last)/1000);last=now;if(playback.playing&&snapshot?.replay)playback.t=Math.min(playback.end,playback.t+dt*playback.speed);const frames=world.render(playback.t,now/1000);if(now-lastUi>100){lastUi=now;controls.sync(playback);if(frames){const [a,b]=frames;world.setCounters(`Replay · shipped ${a.shipped}/${a.views.length} · queue ${a.queued} · damaged ${a.damaged}`,`Replay · shipped ${b.shipped}/${b.views.length} · queue ${b.queued} · damaged ${b.damaged}`);counters?.update(a,b);}}requestAnimationFrame(tick);}
requestAnimationFrame(tick);
void(async()=>{try{
  await loadList();const requested=new URLSearchParams(location.search).get('run');
  // A live run that was just started has no replay yet: wait for its first write instead of falling back.
  if(requested&&/^live-demo-\d+$/.test(requested)&&!entries.some(r=>r.id===requested)){
    message(`Starting ${requested} on Crusoe… waiting for the first replay`);
    for(let i=0;i<90&&!entries.some(r=>r.id===requested);i++){await new Promise(r=>setTimeout(r,2000));await loadList();}
    message(null);
  }
  const id=requested&&entries.some(r=>r.id===requested)?requested:'live-a-11';await choose(id);
}catch(e){message((e as Error).message);}})();
// Localhost-only live control; compiled out of production builds.
if(import.meta.env.DEV)void import('./run-live').then(async m=>{await m.mountRunLive($('operator-content'),{runId:()=>snapshot?.id??null,time:()=>playback.t,hasReplay:()=>!!snapshot?.replay,onInspected:id=>{if(snapshot?.id!==id)return;visualInspection={status:'loading',runId:id};void loadVisualInspection(id).then(r=>{if(snapshot?.id!==id)return;visualInspection=r;setView('visual');});}});$('operator-controls').hidden=!$('operator-content').childElementCount;});
