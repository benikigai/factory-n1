import { createHash } from 'node:crypto';
import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AgentNode, Status } from '../src/runtime.ts';
import type { BackendEvent, Experiment, RunEntry, RunMode, RunSnapshot, ReplayBundle } from '../src/contracts.ts';
import { DEFAULT_DOD, evaluateDoD } from '../../src/sim/dod.ts';

export const validId = (id:string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
async function readJson<T>(file:string):Promise<T|null>{try{return JSON.parse(await readFile(file,'utf8')) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export function parseLines<T>(raw:string):T[]{
  const lines=raw.split('\n');const result:T[]=[];
  for(let i=0;i<lines.length;i++){if(!lines[i].trim())continue;try{result.push(JSON.parse(lines[i]) as T);}catch{if(i<lines.length-1)throw new Error('Invalid completed JSONL record');}}
  return result;
}
async function lines<T>(file:string):Promise<T[]>{try{return parseLines<T>(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}}
interface UiMeta {mode:RunMode;state:RunSnapshot['state'];createdAt:string;error?:string;phase?:string}
interface Summary {runId:string;stopReason?:string;generations?:number;usage?:{calls:number;usd:number;reservedUsd?:number};[key:string]:unknown}
const colors=['#69c4a3','#85b9df','#eba274','#b5a2d7','#d5c778'];
function node(id:string,name:string,role:string,color:string,output:string,status:Status='done',model='Code',children:AgentNode[]=[]):AgentNode{
  return {id,name,role,color,output,task:output,model,children,depends:[],status,progress:status==='done'?1:0,elapsed:0,duration:0};
}

export function buildSnapshot(id:string,replay:ReplayBundle|null,events:BackendEvent[],experiments:Experiment[],meta:UiMeta|null,summary:Summary|null):RunSnapshot {
  const finished=!!summary||events.some(e=>e.type==='run_finished');
  const mode:RunMode=meta?.mode==='simulator'?'simulator':replay?.mode==='synthetic'?'fixture':meta?.state==='running'&&!finished?'live':'recorded';
  const incomplete=!meta&&!finished&&replay?.mode==='live';
  const state=meta?.state==='error'||incomplete?'error':meta?.state==='running'&&!finished?'running':'complete';
  const status:Status=state==='running'?'running':state==='error'?'failed':'done';
  const start=events.find(e=>e.type==='run_started');const models=(start?.models??{}) as Record<string,string>;
  const modelRun=mode!=='simulator'&&mode!=='fixture';
  const research=events.filter(e=>e.type==='research');const hypothesis=events.filter(e=>e.type==='hypothesis_test');
  const researchChildren=research.map((e,i)=>node(`research-${i}`,`Search ${i+1}`,'Research tool',colors[0],`${String(e.query??'Research')}. ${Number(e.added??0)} hypotheses. Sources: ${((e.sources??[]) as string[]).join(', ')}`,e.error?'failed':'done','You.com'));
  researchChildren.push(...hypothesis.map((e,i)=>node(`hypothesis-${i}`,String(e.id??`Hypothesis ${i+1}`),'Isolated simulator test',colors[0],e.untestable?String(e.untestable):`Validation delta: ${e.deltaSelect??'unavailable'}; adopted: ${Boolean(e.adopted)}.`,'done')));
  const researcher=node('research','Researcher','Model agent',colors[0],modelRun?'Searches and tests external hypotheses. Untestable or rejected hypotheses remain visible.':'Not invoked in this simulator-only run.',modelRun?(research.length?'done':state==='running'?'running':'idle'):'idle',models.researcher??models.lightning??'NVIDIA Nemotron Lightning',researchChildren);
  const designers=['flow','capacity'].map((lens,i)=>{
    const attempts=experiments.filter(e=>e.designer===lens).map(e=>{
      const tools=(e.toolReceipts??[]).map((r,j)=>node(`${e.candidateId}-tool-${j}`,r.name,'Tool receipt',colors[1],`Receipt ${r.id}: ${r.status}.`,r.status==='ok'||r.status==='success'?'done':r.status==='error'?'failed':'done','Code'));
      return node(e.candidateId,`Generation ${e.gen}`,'Recorded proposal',colors[1],`${e.rationale??''}\nDecision: ${e.decision}. ${e.reason}\nTrain: ${e.measuredTrain?.objective??'not scored'}; validation: ${e.measuredSelect?.objective??'not scored'}.`,'done',e.model,tools);
    });
    return node(`designer-${lens}`,lens==='flow'?'Flow designer':'Capacity designer','Model agent',colors[1],attempts.length?`${attempts.length} proposals returned. Click a generation to inspect the decision and tool receipts.`:modelRun?'Awaiting proposals.':'Not invoked in simulator-only mode.',modelRun?(attempts.length?status:state==='running'&&research.length?'running':'idle'):'idle',experiments.find(e=>e.designer===lens)?.model??models.designers??models.super??'NVIDIA Nemotron Super',attempts);
  });
  const designerTeam=node('designers','Designers','Agent team',colors[1],'Two distinct lenses: flow and capacity. Each proposal is scored by code.',modelRun?status:'idle','Model team',designers);
  const evaluations=experiments.map((e,i)=>node(`evaluation-${i}`,e.candidateId,'Frozen grader',colors[2],`${e.decision}: ${e.reason}. Train objective ${e.measuredTrain?.objective??'unavailable'}; validation objective ${e.measuredSelect?.objective??'unavailable'}.`,'done'));
  const evaluator=node('evaluator','Evaluator','Code evaluator',colors[2],'The original Factory N+1 simulator computes the scores. A completed run is separate from a met goal.',status,'Factory N+1 simulator',evaluations);
  const memoryChildren=(replay?.lessons??[]).map(l=>node(`lesson-${l.id}`,l.id,'Playbook entry',colors[3],`${l.text}\nEvidence: ${l.basis??l.kind}; status: ${l.status??l.kind}. Citations: ${l.cited??0}.`,'done',l.kind==='verified'?'Measured evidence':'External hypothesis'));
  const memory=node('memory','Shared memory','Playbook and reflection',colors[3],`${memoryChildren.length} lessons. Hypotheses and measured interventions retain their evidence labels.`,memoryChildren.length?'done':'idle',models.reflector??models.super??'Code + model',memoryChildren);
  const checks=replay?evaluateDoD(DEFAULT_DOD,[replay.improved.result]).checks.map(c=>({id:c.id,description:c.description,actual:c.actual,passed:c.passed})):[];
  const supervisor=node('supervisor','Supervisor','Code supervisor',colors[4],summary?.stopReason??(state==='running'?'Monitoring the run and waiting for the next recorded event.':'Recorded run complete.'),status,'Code',checks.map(c=>node(`check-${c.id}`,c.description,'Scenario goal check',colors[4],`Measured ${c.actual}: ${c.passed?'PASS':'FAIL'}. These checks describe the displayed scenario.`,c.passed?'done':'failed')));
  const root=node('factory','Mission control','Run orchestrator',colors[0],replay?.task.goal??String(start?.goal??'Starting the real factory backend.'),status,'Factory N+1',[researcher,designerTeam,evaluator,memory,supervisor]);
  const firstTs=events[0]?.ts??0;
  const normalized=events.map(e=>{
    let message=e.type.replaceAll('_',' '),agent='Supervisor',nodeId='supervisor',kind:'start'|'done'|'error'|'info'='info';
    if(e.type==='run_started'){message=String(e.goal??'Run started');kind='start';agent='Mission control';nodeId='factory';}
    if(e.type==='research'){message=`${Number(e.added??0)} hypotheses from ${String(e.query??'research')}${e.error?'; '+String(e.error):''}`;agent='Researcher';nodeId='research';}
    if(e.type==='hypothesis_test'){message=`${e.id}: ${e.untestable??`delta ${e.deltaSelect??'unavailable'}, adopted ${Boolean(e.adopted)}`}`;agent='Researcher';nodeId='research';}
    if(e.type==='generation'){message=`Generation ${e.gen}: ${e.accepted?`accepted ${e.accepted}`:'no accepted change'}; validation objective ${e.championSelect}.`;agent='Designers';nodeId='designers';kind='done';}
    if(e.type==='run_finished'){message=String(e.stopReason??e.reason??'Run finished');kind='done';}
    return {time:Math.max(0,(e.ts-firstTs)/1000),agent,nodeId,message,kind};
  }).reverse();
  const generations=events.filter(e=>e.type==='generation').length;
  const revision=createHash('sha256').update(JSON.stringify([replay,events,experiments,meta,summary])).digest('hex').slice(0,16);
  return {id,mode,state,revision,replay,tree:root,events:normalized,generations,stopReason:summary?.stopReason??'',checks,activePhase:meta?.phase??(state==='running'?'Backend working':'Run complete'),error:meta?.error??(incomplete?'Incomplete recording. No running worker has been confirmed.':null),reservedUsd:summary?.usage?.reservedUsd??null};
}

export async function findRun(roots:string[],id:string):Promise<string|null>{
  if(!validId(id))return null;
  for(const root of roots){try{const base=await realpath(root),dir=await realpath(path.join(root,id));if(dir.startsWith(base+path.sep)&&(await stat(dir)).isDirectory())return dir;}catch{}}
  return null;
}
export async function readSnapshot(roots:string[],id:string):Promise<RunSnapshot|null>{
  const dir=await findRun(roots,id);if(!dir)return null;
  // Expose only known artifacts; never serve arbitrary files or worker logs.
  const safe=async(name:string)=>{try{const f=await realpath(path.join(dir,name));if(!f.startsWith(dir+path.sep))throw new Error('Artifact escaped run');return f;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return path.join(dir,name);throw e;}};
  const [replay,events,experiments,meta,summary]=await Promise.all([
    safe('replay.json').then(f=>readJson<ReplayBundle>(f)),safe('events.jsonl').then(f=>lines<BackendEvent>(f)),safe('experiments.jsonl').then(f=>lines<Experiment>(f)),safe('ui-meta.json').then(f=>readJson<UiMeta>(f)),safe('summary.json').then(f=>readJson<Summary>(f)),
  ]);
  if(!replay&&!events.length&&!meta)return null;
  return buildSnapshot(id,replay,events,experiments,meta,summary);
}
export async function listRuns(roots:string[]):Promise<RunEntry[]>{
  const seen=new Set<string>(),out:RunEntry[]=[];
  for(const root of roots){let names:string[]=[];try{names=await readdir(root);}catch{}for(const id of names){if(seen.has(id)||!validId(id))continue;seen.add(id);try{const s=await readSnapshot(roots,id);if(s)out.push({id,mode:s.mode,state:s.state,createdAt:s.replay?.createdAt??''});}catch{}}}
  return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
