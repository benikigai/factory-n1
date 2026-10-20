import { mkdir, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface Request { id:string; mode:'simulator'|'live'; backendRoot:string; generations:number; goal:string }
let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input) as Request;
const load=(file:string)=>import(pathToFileURL(path.join(request.backendRoot,file)).href);
const dir=path.join(process.cwd(),'runs',request.id);
await mkdir(dir,{recursive:true});
async function save(name:string,value:unknown){const file=path.join(dir,name);await writeFile(file+'.tmp',JSON.stringify(value));await rename(file+'.tmp',file);}
async function phase(value:string){await save('ui-meta.json',{mode:request.mode==='live'?'live':'simulator',state:'running',createdAt:new Date().toISOString(),phase:value});}
try {
  await phase('Loading Factory N+1');
  const {loadTaskA}=await load('src/tasks/task.ts');
  const task=loadTaskA();if(request.goal)task.goal=request.goal;
  if(request.mode==='live'){
    await phase('Connecting to Crusoe');
    const {crusoe,resolveModels}=await load('src/llm/crusoe.ts');
    resolveModels((await crusoe().models.list()).data.map((m:{id:string})=>m.id));
    await phase('Research, proposals, and validation');
    const {solve}=await load('src/loop/solve.ts');
    const summary=await solve({task,generations:request.generations,runId:request.id,probes:1,searches:1,log:()=>{}});
    await save('ui-meta.json',{mode:'live',state:summary.stopReason?.startsWith('stopped early on error')?'error':'complete',phase:summary.stopReason,createdAt:new Date().toISOString(),error:summary.stopReason?.startsWith('stopped early on error')?'The model run stopped early; recorded results were preserved.':undefined});
  }else{
    const {evaluate}=await load('src/sim/evaluate.ts');
    const {simulate}=await load('src/sim/engine.ts');
    const {makeScenario}=await load('src/sim/scenarios.ts');
    const {SIM_VERSION,graderHash}=await load('src/sim/version.ts');
    const {DEFAULT_DOD}=await load('src/sim/dod.ts');
    const event=async(type:string,data:object)=>appendFile(path.join(dir,'events.jsonl'),JSON.stringify({runId:request.id,ts:Date.now(),type,...data})+'\n');
    const initial=task.initial;
    const candidate={...initial,name:'Coverage heuristic',stations:initial.stations.map((s:{kind:string})=>s.kind==='pack'?{...s,sizes:['S','M','L']}:s)};
    await event('run_started',{taskId:task.id,goal:task.goal,models:{},generations:1,simVersion:SIM_VERSION,graderHash:graderHash(),synthetic:false});
    await phase('Scoring baseline and coverage heuristic');
    const bt=evaluate(initial,'train',DEFAULT_DOD),bs=evaluate(initial,'select',DEFAULT_DOD),ct=evaluate(candidate,'train',DEFAULT_DOD),cs=evaluate(candidate,'select',DEFAULT_DOD);
    const accepted=cs.objective<bs.objective;
    const scenario=makeScenario(202,'peak');
    const side=(label:string,layout:unknown,train:any,select:any)=>({label,layout,result:simulate(layout,scenario),train:{objective:train.objective,dodPassed:train.dod.passed},select:{objective:select.objective,dodPassed:select.dod.passed}});
    const choice=accepted?candidate:initial,train=accepted?ct:bt,select=accepted?cs:bs;
    const experiment={runId:request.id,candidateId:'coverage-heuristic',gen:1,designer:'code-heuristic',model:'none',via:'code',toolReceipts:[],decision:accepted?'accepted':'rejected',reason:'Coverage heuristic scored by the original Factory N+1 evaluator.',rationale:'Allow existing pack stations to handle size L.',candidateLayout:candidate,measuredTrain:{objective:ct.objective},measuredSelect:{objective:cs.objective}};
    await writeFile(path.join(dir,'experiments.jsonl'),JSON.stringify(experiment)+'\n');
    await event('generation',{gen:1,accepted:accepted?'coverage-heuristic':null,championTrain:train.objective,championSelect:select.objective,calls:0,usd:0});
    await save('replay.json',{runId:request.id,mode:'recorded',createdAt:new Date().toISOString(),simVersion:SIM_VERSION,graderHash:graderHash(),task:{id:task.id,goal:task.goal},scenario:{id:scenario.id,seed:scenario.seed,profile:scenario.profile},baseline:side('Gen-0 baseline',initial,bt,bs),improved:side('Coverage heuristic (code, no model)',choice,train,select),comparators:[],accepted:accepted?[{gen:1,candidateId:'coverage-heuristic',designer:'Code heuristic',rationale:experiment.rationale,selectBefore:bs.objective,selectAfter:cs.objective,edits:[],appliedLessons:[]}]:[],rejected:[],lessons:[],curve:[{gen:0,championSelect:bs.objective,candidates:[]},{gen:1,championSelect:select.objective,candidates:[{id:'coverage-heuristic',train:ct.objective,accepted}]}],usage:{calls:0,usd:0,searches:0,searchUsd:0}});
    const summary={runId:request.id,stopReason:'Simulator check complete; no models called.',baseline:{train:bt.objective,select:bs.objective,dodSelect:bs.dod.passed},champion:{train:train.objective,select:select.objective,dodSelect:select.dod.passed},simEvals:4,usage:{calls:0,usd:0}};
    await save('summary.json',summary);await event('run_finished',summary);
    await save('ui-meta.json',{mode:'simulator',state:'complete',createdAt:new Date().toISOString(),phase:summary.stopReason});
  }
}catch{
  await save('ui-meta.json',{mode:request.mode==='live'?'live':'simulator',state:'error',createdAt:new Date().toISOString(),error:'Backend worker failed. Credentials, provider access, or the backend version may need attention.'});
  process.exitCode=1;
}
