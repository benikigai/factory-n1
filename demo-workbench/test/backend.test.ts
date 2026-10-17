import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, symlink, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, readSnapshot, parseLines, findRun } from '../server/snapshot.ts';
import { createFactoryApi } from '../server/api.ts';
import { flatten } from '../src/runtime.ts';
import { frameAt, playbackEnd } from '../../web/world/state.ts';

const appRoot=fileURLToPath(new URL('..',import.meta.url)),backendRoot=path.resolve(appRoot,'..');

test('recorded model run maps actual proposals, checks and metrics',async()=>{
  const s=await readSnapshot([path.join(backendRoot,'recorded')],'live-a-5');assert.ok(s?.replay);
  assert.equal(s.mode,'recorded');assert.equal(s.state,'complete');
  assert.equal(s.replay.improved.select.objective,10733.22);assert.equal(s.replay.baseline.select.objective,18061.11);
  assert.equal(s.replay.improved.result.metrics.makespan,729);
  assert.equal(s.replay.improved.result.metrics.damaged,13);
  assert.equal(s.checks.find(c=>c.id==='damaged')?.passed,false);
  const nodes=flatten(s.tree);assert.ok(nodes.some(n=>n.id==='g1-flow'));assert.ok(nodes.some(n=>n.role==='Tool receipt'));
  assert.ok(!nodes.some(n=>n.name==='Architect'));assert.equal(s.generations,4);
});

test('replay frame reaches the exact scored final shipment and damage counts',async()=>{
  const s=await readSnapshot([path.join(backendRoot,'recorded')],'live-a-5');assert.ok(s?.replay);
  for(const side of [s.replay.baseline,s.replay.improved]){const f=frameAt(side.result.trace,side.layout,playbackEnd(side.result.trace)+1);assert.equal(f.shipped,side.result.metrics.shipped);assert.equal(f.damaged,side.result.metrics.damaged);assert.equal(f.queued,0);}
});

test('completed cost reporting retains reservations for uncertain provider billing',()=>{
  const s=buildSnapshot('cost-check',null,[],[],null,{runId:'cost-check',usage:{calls:15,usd:.003731,reservedUsd:.1055376}});
  assert.equal(s.reservedUsd,.1055376);
  assert.equal(buildSnapshot('older-run',null,[],[],null,null).reservedUsd,null);
});

test('JSONL reads a complete prefix but rejects malformed complete records',()=>{
  assert.deepEqual(parseLines('{"type":"a"}\n{"type":'),[{type:'a'}]);
  assert.throws(()=>parseLines('{broken}\n{"type":"a"}\n'));
});

test('run paths reject traversal and symlinks outside the allowed root',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'factory-paths-'));
  try{await mkdir(path.join(root,'runs'));await mkdir(path.join(root,'outside'));await symlink(path.join(root,'outside'),path.join(root,'runs','escape'));
    assert.equal(await findRun([path.join(root,'runs')],'../outside'),null);assert.equal(await findRun([path.join(root,'runs')],'escape'),null);
    await mkdir(path.join(root,'runs','good'));await writeFile(path.join(root,'outside','replay.json'),'{}');await symlink(path.join(root,'outside','replay.json'),path.join(root,'runs','good','replay.json'));
    await assert.rejects(()=>readSnapshot([path.join(root,'runs')],'good'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('API starts the real simulator, polls results, enforces local origin and validates input',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'factory-api-'));await symlink(path.join(appRoot,'node_modules'),path.join(root,'node_modules'));
  const api=createFactoryApi(root,backendRoot);const server=createServer((req,res)=>void api.middleware(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
  const post=(data:unknown,originHeader=origin)=>fetch(origin+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json',Origin:originHeader},body:JSON.stringify(data)});
  try{
    assert.equal((await post({mode:'simulator'},'http://untrusted.test')).status,403);
    assert.equal((await post({mode:'live',allowPaid:false})).status,403);
    assert.equal((await post({mode:'simulator',goal:'arbitrary goal'})).status,400);
    assert.equal((await post({mode:'simulator',generations:200})).status,400);
    assert.equal((await post(null)).status,400);
    const response=await post({mode:'simulator'});assert.equal(response.status,202);const {id}=await response.json() as {id:string};
    assert.equal((await post({mode:'simulator'})).status,409);
    let snapshot:any;
    for(let i=0;i<100;i++){snapshot=await (await fetch(origin+'/api/runs/'+id)).json();if(snapshot.state!=='running')break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(snapshot.state,'complete');assert.equal(snapshot.mode,'simulator');assert.equal(snapshot.replay.usage.calls,0);
    assert.equal(snapshot.replay.improved.select.objective,13194.44);assert.equal(snapshot.replay.improved.result.metrics.shipped,100);assert.equal(snapshot.replay.improved.result.metrics.missorts,0);
    assert.equal(snapshot.replay.improved.select.dodPassed,false);assert.equal(snapshot.tree.children.find((n:any)=>n.id==='designers').status,'idle');
    assert.equal((await fetch(origin+'/api/runs/missing')).status,404);
    const second=await (await post({mode:'simulator'})).json() as {id:string};
    const stop=await fetch(`${origin}/api/runs/${second.id}/stop`,{method:'POST',headers:{Origin:origin}});assert.equal(stop.status,200);
    let stopped:any;
    for(let i=0;i<30;i++){stopped=await (await fetch(`${origin}/api/runs/${second.id}`)).json();if(stopped.state==='error')break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(stopped.state,'error');
  }finally{api.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
