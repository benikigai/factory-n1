import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot } from '../server/snapshot';
import {fileURLToPath} from 'node:url';
import { previewDemand, stationFailures } from '../src/factory-guide';
import { simulate } from '../../src/sim/engine';
import type { Layout, Scenario } from '../../src/sim/types';

test('demand previews use the simulator without changing saved results or agent evidence', async () => {
  const snapshot = await readSnapshot([fileURLToPath(new URL('../../recorded/',import.meta.url))], 'live-a-5');
  assert.ok(snapshot?.replay);
  const original = JSON.stringify(snapshot.replay);
  const previews = ['normal', 'peak', 'fragile'].map(profile => previewDemand(snapshot.replay!, profile as 'normal'|'peak'|'fragile'));
  for (const p of previews) {
    assert.equal(p.baseline.result.trace.length, 100);
    assert.deepEqual(p.improved.layout, snapshot.replay.improved.layout);
    assert.deepEqual(p.accepted, snapshot.replay.accepted);
  }
  assert.deepEqual(previews[1].baseline.result.metrics, snapshot.replay.baseline.result.metrics);
  assert.deepEqual(previews[1].improved.result.metrics, snapshot.replay.improved.result.metrics);
  assert.ok(previews[2].baseline.result.trace.filter(t=>t.fragile).length > previews[0].baseline.result.trace.filter(t=>t.fragile).length);
  assert.equal(JSON.stringify(snapshot.replay), original);
});

test('station evidence distinguishes the 12-cell boundary, upstream damage and fallback routing', () => {
  const layout:Layout={name:'boundary',grid:{w:20,h:10},stations:[
    {id:'recv',kind:'receiving',x:0,y:0},{id:'sort',kind:'sorter',x:12,y:0},
    {id:'pack',kind:'pack',x:12,y:1,sizes:['S'],zones:['A']},{id:'ship',kind:'shipping',x:12,y:2,zones:['A']},
  ]};
  const scenario:Scenario={id:'boundary',seed:1,profile:'fragile',packages:[{id:1,arrival:0,size:'S',zone:'A',fragile:true}]};
  assert.equal(simulate(layout,scenario).metrics.damaged,0,'exactly 12 cells is safe');
  const moved=structuredClone(layout);moved.stations[1].x=13;
  const damaged=simulate(moved,scenario);
  const pack=stationFailures(moved.stations[2],damaged.trace);
  assert.equal(pack.arrivedDamaged,1);
  assert.equal(pack.inbound[0].damagedHere,0,'damage occurred upstream, not on this short inbound leg');
  assert.equal(stationFailures(moved.stations[1],damaged.trace).inbound[0].damagedHere,1);
  const unsupported=structuredClone(scenario);unsupported.packages[0].size='L';
  const fallback=simulate(layout,unsupported);
  assert.equal(fallback.metrics.missorts,1);
  assert.equal(fallback.metrics.shipped,1,'a fallback can still reach the correct shipping dock');
  assert.equal(stationFailures(layout.stations[2],fallback.trace).fallback,1);
});
