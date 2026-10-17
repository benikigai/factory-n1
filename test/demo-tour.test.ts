import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_RUN, DEMO_TOURS, demoPosition, demoAgent } from '../web/demo-tour';
import { buildSnapshot, parseLines } from '../web/snapshot';
import { previewDemand, stationFailures } from '../web/factory-guide';
import { simulate } from '../src/sim/engine';
import type { BackendEvent, Experiment, ReplayBundle } from '../web/contracts';
import type { Layout, Scenario } from '../src/sim/types';
const read=(name:string)=>readFileSync(`recorded/${DEMO_RUN}/${name}`,'utf8');
const replay=JSON.parse(read('replay.json')) as ReplayBundle;
const snapshot=buildSnapshot(DEMO_RUN,replay,parseLines<BackendEvent>(read('events.jsonl')),parseLines<Experiment>(read('experiments.jsonl')),JSON.parse(read('summary.json')));

test('run 11 tour targets real stations, accepted route proposal, and recorded metrics',()=>{
  assert.equal(DEMO_RUN,'live-a-11');
  assert.equal(replay.scenario.id,'peak-202');
  assert.deepEqual([replay.baseline.result.metrics.makespan,replay.improved.result.metrics.makespan],[1581,1184]);
  assert.equal(replay.improved.result.metrics.damaged,0);
  assert.equal(replay.improved.result.metrics.missorts,0);
  assert.equal(replay.improved.select.objective,3283.44);
  assert.equal(replay.improved.final,undefined);
  for(const step of DEMO_TOURS.flatMap(tour=>tour.steps)){
    if(step.station)assert.ok(replay[step.station.side].layout.stations.some(station=>station.id===step.station!.id),step.title);
    if(step.agentPath)assert.ok(demoAgent(snapshot.tree,step.agentPath),step.title);
  }
  const proposal=demoAgent(snapshot.tree,['Designers','Route designer','Generation 1']);
  assert.match(proposal.output,/Code decision: accepted/);
  assert.ok(proposal.children.some(node=>node.name==='simulate_layout'));
  const packing=replay.improved.layout.stations.find(s=>s.id==='pack-B')!;
  const routes=stationFailures(packing,replay.improved.result.trace);
  assert.equal(routes.arrivedDamaged,0);
  assert.equal(routes.inbound[0].cells,11);
  assert.equal(routes.inbound[0].damagedHere,0);
});

test('demand previews preserve the recording and match the real simulator',()=>{
  const before=JSON.stringify(replay);
  for(const profile of ['normal','peak','fragile'] as const){
    const preview=previewDemand(replay,profile);
    assert.equal(preview.improved.result.trace.length,100);
    assert.deepEqual(preview.accepted,replay.accepted);
    assert.deepEqual(preview.improved.select,replay.improved.select);
    assert.deepEqual(preview.improved.layout,replay.improved.layout);
    if(profile==='peak')assert.deepEqual(preview.improved.result.metrics,replay.improved.result.metrics);
  }
  assert.equal(JSON.stringify(replay),before);
});

test('station failures distinguish the safe boundary and upstream damage',()=>{
  const layout:Layout={name:'boundary',grid:{w:20,h:10},stations:[
    {id:'recv',kind:'receiving',x:0,y:0},{id:'sort',kind:'sorter',x:12,y:0},
    {id:'pack',kind:'pack',x:12,y:1,sizes:['S'],zones:['A']},{id:'ship',kind:'shipping',x:12,y:2,zones:['A']},
  ]};
  const scenario:Scenario={id:'boundary',seed:1,profile:'fragile',packages:[{id:1,arrival:0,size:'S',zone:'A',fragile:true}]};
  assert.equal(simulate(layout,scenario).metrics.damaged,0);
  const moved=structuredClone(layout);moved.stations[1].x=13;
  const damaged=simulate(moved,scenario);
  assert.equal(stationFailures(moved.stations[2],damaged.trace).arrivedDamaged,1);
  assert.equal(stationFailures(moved.stations[2],damaged.trace).inbound[0].damagedHere,0);
  assert.equal(stationFailures(moved.stations[1],damaged.trace).inbound[0].damagedHere,1);
});


test('the two tours fit their time and spoken-word budgets',()=>{
  for(const tour of DEMO_TOURS){
    assert.equal(tour.steps.reduce((sum,step)=>sum+step.seconds,0),tour.seconds);
    const words=tour.steps.flatMap(step=>step.say).join(' ').split(/\s+/).length;
    assert.ok(words<=tour.seconds*2.25,`${tour.id}: ${words} words leaves too little time for clicks`);
    assert.equal(demoPosition(tour,0).index,0);
    assert.equal(demoPosition(tour,tour.seconds-.1).complete,false);
    assert.equal(demoPosition(tour,tour.seconds).complete,true);
    assert.equal(demoPosition(tour,tour.seconds+10).index,tour.steps.length-1);
    for(const step of tour.steps)assert.ok(step.say.join(' ').split(/\s+/).length<=step.seconds*2, `${step.title} exceeds 120 words/minute`);
    let offset=0;
    for(let i=0;i<tour.steps.length;i++){
      assert.equal(demoPosition(tour,offset).index,i);
      offset+=tour.steps[i].seconds;
    }
  }
  assert.equal(DEMO_TOURS[0].steps.length,4);
  assert.equal(DEMO_TOURS[1].steps.length,8);
});
