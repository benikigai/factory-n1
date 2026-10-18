import type { AgentNode, Status } from './runtime.ts';
import type { BackendEvent, Experiment, RunMode, RunSnapshot, ReplayBundle } from './contracts.ts';
import { DEFAULT_DOD, evaluateDoD } from '../src/sim/dod.ts';
interface Summary { runId:string; stopReason?:string; generations?:number; usage?:{calls:number;usd:number;reservedUsd?:number} }
export function parseLines<T>(raw:string):T[]{ return raw.split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line) as T); }
const colors=['#69c4a3','#85b9df','#eba274','#b5a2d7','#d5c778'];
function node(id:string,name:string,role:string,color:string,output:string,status:Status='done',model='Code',children:AgentNode[]=[]):AgentNode{
  return {id,name,role,color,output,task:output,model,children,depends:[],status,progress:status==='done'?1:0,elapsed:0,duration:0};
}

export function buildSnapshot(id:string,replay:ReplayBundle|null,events:BackendEvent[],experiments:Experiment[],summary:Summary|null):RunSnapshot {
  const live=replay?.mode==='live';
  const mode:RunMode=live?'live':replay?.mode==='synthetic'?'fixture':'recorded';
  const state:RunSnapshot['state']=live?'running':'complete';
  const status:Status='done';
  const start=events.find(e=>e.type==='run_started');const models=(start?.models??{}) as Record<string,string>;
  const modelRun=mode!=='fixture';
  const research=events.filter(e=>e.type==='research');const curve0=(replay as {curve?:{championSelect:number}[]}|null)?.curve?.[0];const continued=!!replay&&!!curve0&&Math.abs(curve0.championSelect-(replay as ReplayBundle).baseline.select.objective)>0.01;const hypothesis=events.filter(e=>e.type==='hypothesis_test');
  const researchChildren=research.map((e,i)=>node(`research-${i}`,`Search ${i+1}`,'Research tool',colors[0],`${String(e.query??'Research')}. ${Number(e.added??0)} hypotheses. Sources: ${((e.sources??[]) as string[]).join(', ')}`,e.error?'failed':'done','You.com'));
  researchChildren.push(...hypothesis.map((e,i)=>node(`hypothesis-${i}`,String(e.id??`Hypothesis ${i+1}`),'Isolated simulator test',colors[0],e.untestable?String(e.untestable):`Validation delta: ${e.deltaSelect??'unavailable'}; adopted: ${Boolean(e.adopted)}.`,'done')));
  const researcher=node('research','Researcher','Model agent',colors[0],!modelRun?'Not invoked in this simulator-only run.':research.length||hypothesis.length?'Searches and tests external hypotheses. Untestable or rejected hypotheses remain visible.':continued?'No new searches in this run. It continued from an earlier run\'s floor and shared memory, which already held the research. Pick live-a-7 in the run list to open the searches and hypothesis tests.':'Searches and tests external hypotheses. None were recorded in this run.',research.length?'done':'idle',models.researcher??models.lightning??'NVIDIA Nemotron Lightning',researchChildren);
  const lenses = [...new Set(experiments.map(e => e.designer).filter(name => name !== 'hypothesis-test'))];
  const designers=lenses.map(lens=>{
    const attempts=experiments.filter(e=>e.designer===lens).map(e=>{
      const tools=(e.toolReceipts??[]).map((r,j)=>node(`${e.candidateId}-tool-${j}`,r.name,'Tool receipt',colors[1],`Receipt ${r.id}: ${r.status}.`,r.status==='error'?'failed':'done','Code'));
      return node(e.candidateId,`Generation ${e.gen}`,'Recorded proposal',colors[1],`Model rationale:\n${e.rationale??'Not recorded'}\n\nCode decision: ${e.decision}. ${e.reason}\nMeasured train objective: ${e.measuredTrain?.objective??'not scored'}; validation objective: ${e.measuredSelect?.objective??'not scored'}.`,'done',e.model,tools);
    });
    const label=lens.replace(/(^|[-_ ])([a-z])/g,(_,space,letter)=>`${space?' ':''}${letter.toUpperCase()}`);
    return node(`designer-${lens}`,`${label} designer`,'Model agent',colors[1],`${attempts.length} recorded proposals. Open a generation for the measured decision and tool receipts.`,status,experiments.find(e=>e.designer===lens)?.model??models.designers??models.super??'NVIDIA Nemotron Super',attempts);
  });
  const designerTeam=node('designers','Designers','Agent team',colors[1],`${lenses.length} recorded lenses: ${lenses.join(', ')}. Each proposal is scored by code.`,status,'Model team',designers);
  const evaluations=experiments.map((e,i)=>node(`evaluation-${i}`,e.candidateId,'Frozen grader',colors[2],`${e.decision}: ${e.reason}. Train objective ${e.measuredTrain?.objective??'unavailable'}; validation objective ${e.measuredSelect?.objective??'unavailable'}.`,'done'));
  const evaluator=node('evaluator','Evaluator','Code evaluator',colors[2],'The original Factory N+1 simulator computes the scores. A completed run is separate from a met goal.',status,'Factory N+1 simulator',evaluations);
  const memoryChildren=(replay?.lessons??[]).map(l=>node(`lesson-${l.id}`,l.id,'Playbook entry',colors[3],`${l.text}\nEvidence: ${l.basis??l.kind}; status: ${l.status??l.kind}. Citations: ${l.cited??0}.`,'done',l.basis==='observed-from-rejected-experiment'?'Observation from rejected experiment':l.basis==='observed-from-experiment'?'Observation from accepted experiment':l.basis==='isolated-test'?'Isolated intervention result':'External hypothesis'));
  const memory=node('memory','Shared memory','Playbook and reflection',colors[3],`${memoryChildren.length} lessons. Hypotheses and measured interventions retain their evidence labels.`,memoryChildren.length?'done':'idle',models.reflector??models.super??'Code + model',memoryChildren);
  const checks=replay?evaluateDoD(DEFAULT_DOD,[replay.improved.result]).checks.map(c=>({id:c.id,description:c.description,actual:c.actual,passed:c.passed})):[];
  const supervisor=node('supervisor','Supervisor','Code supervisor',colors[4],summary?.stopReason??'Recorded run complete.',status,'Code',checks.map(c=>node(`check-${c.id}`,c.description,'Scenario goal check',colors[4],`Measured ${c.actual}: ${c.passed?'PASS':'FAIL'}. These checks describe the displayed scenario.`,c.passed?'done':'failed')));
  const root=node('factory','Mission control','Run orchestrator',colors[0],replay?.task.goal??String(start?.goal??'Starting the real factory backend.'),status,'Factory N+1',[...(events.length?[researcher]:[]),...(designers.length?[designerTeam]:[]),evaluator,...(memoryChildren.length?[memory]:[]),supervisor]);
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
  const revision=`${id}:${events.length}:${experiments.length}:${replay?.mode}:${replay?.usage?.calls??0}`;
  return {id,mode,state,revision,replay,tree:root,events:normalized,generations,stopReason:summary?.stopReason??'',checks,activePhase:'Recorded run complete',error:null,reservedUsd:summary?.usage?.reservedUsd??null};
}
