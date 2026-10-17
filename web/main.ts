import './style.css';
import { h, fmtNum, fmtTime } from './ui/dom';
import { renderHud, renderLegend, renderRail, type CounterEls } from './ui/panel';
import { createControls, type Playback } from './ui/controls';
import { createWarehouse, type Selection } from './world/warehouse';
import { playbackEnd } from './world/state';
import type { BackendEvent, Experiment, RunEntry, RunSnapshot, ReplayBundle } from './contracts';
import { buildSnapshot, parseLines } from './snapshot';
import { flatten, type AgentNode } from './runtime';

const $=(id:string)=>document.getElementById(id)!;
const modeText={recorded:'RECORDED',live:'LIVE',simulator:'SIMULATOR',fixture:'SYNTHETIC'};
let snapshot:RunSnapshot|null=null,scope:AgentNode|null=null,selected:Selection|null=null;
let view:'layout'|'agents'='layout',entries:RunEntry[]=[],artifacts:Record<string,string[]>={};
let counters:CounterEls|null=null,version=0;
const playback:Playback={t:0,end:1,playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,speed:16};

document.querySelector('#app')!.innerHTML=`
<main id="stage"><div id="scene"></div>
<header id="hud"><a class="brand" href="./">Factory N+1</a><div id="mode-badge" class="mode">LOADING</div><div id="hud-meta"></div></header>
<nav id="breadcrumbs" aria-label="Agent factory breadcrumbs" hidden></nav>
<div id="empty-scene" hidden>Loading recorded simulator traces…</div>
<div id="legend"></div><footer id="controls"></footer><div id="connection" role="status" hidden></div></main>
<aside id="rail"><section class="run-controls"><div class="run-actions"><label for="run-select">RUN</label><a href="./" class="btn">Back to proof</a></div><select id="run-select" aria-label="Select run"></select><div class="run-state"><span id="run-status">Loading recording…</span></div><div class="view-switch" role="group" aria-label="Factory view"><button id="layout-view" class="btn active">Factory layouts</button><button id="agents-view" class="btn">Agent factories</button></div></section><section id="inspection" hidden></section><section class="run-summary" id="run-summary"></section><div id="metrics-panel"></div><section class="artifact-links" id="run-evidence"></section><section><button id="download" class="btn" disabled>Download run evidence</button></section></aside>
`;

async function json<T>(url:string):Promise<T>{const response=await fetch(url);if(!response.ok)throw new Error(`Could not load ${url} (${response.status})`);return response.json();}
async function lines<T>(url:string):Promise<T[]>{const response=await fetch(url);return response.ok?parseLines<T>(await response.text()):[];}
function message(text:string|null){$('connection').textContent=text;$('connection').hidden=!text;}
function button(text:string,action:()=>void,attrs:Record<string,string>={}){const b=h('button',{class:'btn',...attrs},text);b.onclick=action;return b;}
const world=createWarehouse($('scene'),selection=>{selected=selection;if(selection.type==='agent')enter(selection.node);else renderInspection();$('rail').scrollTop=0;});
const controls=createControls($('controls'),playback,{seek:t=>{playback.t=t;},toggle:()=>{if(playback.t>=playback.end)playback.t=0;playback.playing=!playback.playing;},speed:s=>{playback.speed=s;},camera:p=>world.preset(p)});
$('controls').querySelector('input')!.setAttribute('aria-label','Replay time');
$('controls').querySelector('select')!.setAttribute('aria-label','Replay speed');
renderLegend($('legend'));
function link(n:AgentNode){for(const c of n.children){c.parent=n;link(c);}}
function nodes(){return snapshot?flatten(snapshot.tree):[];}
function enter(n:AgentNode){selected={type:'agent',node:n};if(n.children.length){scope=n;view='agents';world.setAgents(n);}const url=new URL(location.href);url.searchParams.set('view','agents');url.searchParams.set('node',n.id);history.replaceState(null,'',url);renderNavigation();renderInspection();$('rail').scrollTop=0;}
function setView(next:typeof view){view=next;selected=null;const url=new URL(location.href);url.searchParams.set('view',next);url.searchParams.delete('node');history.replaceState(null,'',url);if(next==='agents'&&snapshot){scope=snapshot.tree;world.setAgents(scope);}else if(snapshot?.replay){world.setBundle(snapshot.replay);world.preset('overview',false);}renderNavigation();renderInspection();}
function renderNavigation(){
  const agentView=view==='agents';$('stage').classList.toggle('agent-view',agentView);
  $('layout-view').classList.toggle('active',!agentView);$('agents-view').classList.toggle('active',agentView);
  $('breadcrumbs').hidden=!agentView;$('legend').hidden=agentView;
  ($('layout-view') as HTMLButtonElement).disabled=!snapshot?.replay;
  if(scope){const path:AgentNode[]=[];let n:AgentNode|undefined=scope;while(n){path.unshift(n);n=n.parent;}
    $('breadcrumbs').replaceChildren(...path.flatMap((item,i)=>[...(i?[h('span',null,'/')]:[]),button(item.id==='factory'?'Agent factories':item.name,()=>enter(item))]));}
  controls.setCloseupLabel(world.closeupTarget());
}
function renderInspection(){
  const panel=$('inspection');panel.replaceChildren();panel.hidden=!selected&&view==='layout';if(panel.hidden||!snapshot)return;
  panel.append(h('div',{class:'section-heading'},h('h3',null,selected?.type==='station'?'Station inspector':'Agent inspector'),button('Close',()=>{selected=null;setView('layout');},{'aria-label':'Close inspector'})));
  if(selected?.type==='station'){
    const stationId=selected.id;
    const s=snapshot.replay?.[selected.side],station=s?.layout.stations.find(n=>n.id===stationId),stats=s?.result.metrics.stations[stationId];
    panel.append(h('h2',null,selected.id),h('p',{class:'small'},`${selected.side==='baseline'?'Baseline':'Champion'} · ${station?.kind??'station'}`));
    if(stats)panel.append(h('dl',{class:'station-stats'},...Object.entries({'Processed':stats.processed,'Total wait':`${fmtNum(stats.totalWait)} s`,'Max queue':stats.maxQueue,'Utilization':`${(stats.utilization*100).toFixed(1)}%`}).flatMap(([key,value])=>[h('dt',null,key),h('dd',null,value)])));
    panel.append(button('Open agent factories',()=>setView('agents')));return;
  }
  const n=selected?.type==='agent'?selected.node:scope??snapshot.tree;
  panel.append(h('h2',null,n.name),h('p',{class:'small'},`${n.role} · ${n.model}`),h('span',{class:`state state-${n.status}`},n.status==='idle'?'Not invoked / not yet recorded':n.status==='done'?'Recorded result':n.status),h('p',{class:'node-output'},n.output||n.task));
  if(n.children.length)panel.append(h('h3',null,`${n.children.length} child entries`),h('div',{class:'child-list'},...n.children.map(child=>button(`${child.name} · ${child.role}${child.children.length?' ↗':''}`,()=>enter(child),{'data-node':child.id}))));
  const ids=new Set(flatten(n).map(c=>c.id)),events=snapshot.events.filter(e=>ids.has(e.nodeId));
  if(events.length){const details=h('details',null,h('summary',null,`Recorded events (${events.length})`),...events.map(e=>h('p',{class:'small'},`${fmtTime(e.time)} · ${e.agent}: ${e.message}`)));panel.append(details);}
  panel.append(h('p',{class:'small'},'These are recorded roles, proposals, tools and checks. The floor arranges records for navigation; it is not a simulated fulfillment layout.'));
}
function renderData(){
  if(!snapshot)return;
  $('mode-badge').textContent=modeText[snapshot.mode];$('mode-badge').className=`mode mode-${snapshot.mode==='fixture'?'synthetic':snapshot.mode==='live'?'live':'recorded'}`;
  $('run-status').textContent=snapshot.state==='running'?`Live · ${snapshot.generations} generation${snapshot.generations===1?'':'s'} scored so far · refreshing every 2 s`:snapshot.generations?`Complete · ${snapshot.generations} recorded generations`:'Recorded comparison';
  const option=Array.from(($('run-select') as HTMLSelectElement).options).find(o=>o.value===snapshot!.id);if(option)option.textContent=`${snapshot.id} · ${modeText[snapshot.mode].toLowerCase()}`;
  $('empty-scene').hidden=!!snapshot.replay||view==='agents';
  ($('download') as HTMLButtonElement).disabled=!snapshot.replay;
  if(snapshot.replay){
    const replay={...snapshot.replay,mode:(snapshot.state==='running'?'live':snapshot.mode==='fixture'?'synthetic':'recorded') as 'live'|'synthetic'|'recorded'};
    renderHud($('mode-badge'),$('hud-meta'),replay);$('mode-badge').textContent=modeText[snapshot.mode];
    const scroll=$('rail').scrollTop;counters=renderRail($('metrics-panel'),replay);$('rail').scrollTop=scroll;
    const usage=replay.usage,total=usage.usd+usage.searchUsd;
    $('run-summary').replaceChildren(h('div',{class:'goal-line'},h('span',null,replay.improved.final?'Shared memory: final goal':'Validation goal'),h('strong',{class:(replay.improved.final?.dodPassed??replay.improved.select.dodPassed)?'pass':'fail'},(replay.improved.final?.dodPassed??replay.improved.select.dodPassed)?'PASS':'NOT MET')),h('div',{class:'small'},`${usage.calls} model calls · ${usage.searches} searches · $${total.toFixed(4)} estimated`),...(snapshot.reservedUsd?[h('div',{class:'small'},`$${snapshot.reservedUsd.toFixed(4)} additionally reserved for unknown billing`)]:[]));
  }else{$('hud-meta').textContent=snapshot.tree.output;$('metrics-panel').replaceChildren(h('p',{class:'empty'},'No scored replay exists in this recording.'));$('run-summary').replaceChildren();counters=null;}
  if(snapshot.error)message(snapshot.error);
}
function apply(data:RunSnapshot){
  if(snapshot?.id===data.id&&snapshot.revision===data.revision)return;
  const isNew=snapshot?.id!==data.id,scopeId=scope?.id,selectedId=selected?.type==='agent'?selected.node.id:null;
  const previousReplay=snapshot?.replay;link(data.tree);snapshot=data;
  if(isNew){playback.t=0;selected=null;scope=data.tree;view='layout';}
  else{scope=nodes().find(n=>n.id===scopeId)??data.tree;if(selectedId){const node=nodes().find(n=>n.id===selectedId);selected=node?{type:'agent',node}:null;}}
  if(view==='agents'&&scope)world.setAgents(scope);else if(data.replay&&previousReplay!==data.replay){world.setBundle(data.replay);if(isNew)world.preset('overview',false);}
  playback.end=data.replay?Math.max(1,playbackEnd(data.replay.baseline.result.trace,data.replay.improved.result.trace)):1;playback.t=Math.min(playback.t,playback.end);controls.setEnd(playback.end);
  renderNavigation();renderData();renderInspection();
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
  return buildSnapshot(id,replay,events,experiments,summary);
}
let pollTimer:ReturnType<typeof setTimeout>|undefined;
/** While the loaded run is live, re-fetch it every 2 s. apply() keeps the camera, view and selection. */
function poll(id:string){
  clearTimeout(pollTimer);
  if(snapshot?.id!==id||snapshot.state!=='running')return;
  pollTimer=setTimeout(async()=>{const v=version;try{const data=await fetchRun(id);if(v===version)apply(data);}catch{/* keep the last good frame */}poll(id);},2000);
}
async function choose(id:string){
  const v=++version;message(null);clearTimeout(pollTimer);
  try{
    const base=`./runs/${encodeURIComponent(id)}`;
    const available=artifacts[id]??['replay.json'];
    const data=await fetchRun(id);
    if(v!==version)return;
    apply(data);
    poll(id);
    const url=new URL(location.href);url.searchParams.set('run',id);history.replaceState(null,'',url);
    ($('run-select') as HTMLSelectElement).value=id;
    const params=new URLSearchParams(location.search);const requested=params.get('view');const nodeId=params.get('node');if(requested==='agents')setView('agents');
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
$('run-select').onchange=()=>void choose(($('run-select') as HTMLSelectElement).value);
$('layout-view').onclick=()=>setView('layout');$('agents-view').onclick=()=>setView('agents');
$('download').onclick=()=>{if(!snapshot)return;const blob=new Blob([JSON.stringify({id:snapshot.id,mode:snapshot.mode,replay:snapshot.replay,events:snapshot.events,reservedUsd:snapshot.reservedUsd,checks:snapshot.checks},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=h('a',{href:url,download:`${snapshot.id}-evidence.json`});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&view==='agents'&&!document.querySelector('dialog[open]')){if(scope?.parent)enter(scope.parent);else setView('layout');}});
let last=performance.now(),lastUi=0;
function tick(now:number){const dt=Math.min(.1,(now-last)/1000);last=now;if(playback.playing&&snapshot?.replay)playback.t=Math.min(playback.end,playback.t+dt*playback.speed);const frames=world.render(playback.t,now/1000);if(now-lastUi>100){lastUi=now;controls.sync(playback);if(frames){const [a,b]=frames;world.setCounters(`shipped ${a.shipped}/${a.views.length} · queue ${a.queued} · damaged ${a.damaged}`,`shipped ${b.shipped}/${b.views.length} · queue ${b.queued} · damaged ${b.damaged}`);counters?.update(a,b);}}requestAnimationFrame(tick);}
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
if(import.meta.env.DEV)void import('./run-live').then(m=>m.mountRunLive(document.querySelector('.run-controls')!));
