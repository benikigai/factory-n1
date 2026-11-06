import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSnapshot} from '../server/snapshot';
import {flatten} from '../src/runtime';
import {teamLayout} from '../src/claude/world/team-layout';

test('every recorded child remains reachable in a bounded presentation floor',async()=>{
  const root=fileURLToPath(new URL('../../recorded/',import.meta.url));
  const snapshot=await readSnapshot([path.resolve(root)],'live-a-5');assert.ok(snapshot?.replay);
  const before=JSON.stringify(snapshot.replay);
  for(const node of flatten(snapshot.tree)){
    const layout=teamLayout(node);
    assert.deepEqual(layout.stations.map(s=>s.id),node.children.map(n=>n.id));
    assert.equal(new Set(layout.stations.map(s=>`${s.x},${s.y}`)).size,node.children.length);
    for(const station of layout.stations){assert.ok(station.x>0&&station.x<layout.grid.w-1);assert.ok(station.y>0&&station.y<layout.grid.h-1);}
  }
  assert.equal(JSON.stringify(snapshot.replay),before,'presentation layouts must never mutate scored layouts');
});
