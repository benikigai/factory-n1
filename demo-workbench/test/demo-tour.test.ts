import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readSnapshot} from '../server/snapshot';
import {DEMO_RUN, DEMO_STEPS, demoAgent} from '../src/demo-tour';

test('guided narration is bound to the recorded run and every station and agent target exists',async()=>{
  const snapshot=await readSnapshot([fileURLToPath(new URL('../../recorded/',import.meta.url))],DEMO_RUN);
  assert.ok(snapshot?.replay);
  assert.equal(snapshot.replay.scenario.id,'peak-202');
  const before=JSON.stringify(snapshot.replay);
  const {baseline,improved}=snapshot.replay;
  assert.deepEqual([baseline.result.metrics.makespan,improved.result.metrics.makespan],[1581,729]);
  assert.deepEqual([baseline.result.metrics.missorts,improved.result.metrics.missorts],[16,0]);
  assert.deepEqual([baseline.result.metrics.damaged,improved.result.metrics.damaged],[14,13]);
  for(const step of DEMO_STEPS){
    if(step.station)assert.ok(snapshot.replay[step.station.side].layout.stations.some(s=>s.id===step.station!.id));
    if(step.agentPath)assert.ok(demoAgent(snapshot.tree,step.agentPath));
  }
  const receipt=demoAgent(snapshot.tree,['Designers','Flow designer','Generation 1','simulate_layout']);
  assert.match(receipt.output,/chatcmpl-tool-9dabf19c21598c61/);
  assert.equal(JSON.stringify(snapshot.replay),before);
  assert.throws(()=>demoAgent(snapshot.tree,['Nonexistent agent']),/missing/);
});
