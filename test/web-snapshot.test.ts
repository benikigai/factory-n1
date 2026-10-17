import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BackendEvent, Experiment, ReplayBundle } from '../web/contracts.ts';
import { flatten } from '../web/runtime.ts';
import { buildSnapshot, parseLines } from '../web/snapshot.ts';
import { frameAt, playbackEnd } from '../web/world/state.ts';

const read = (file: string) => readFileSync(`recorded/live-a-7/${file}`, 'utf8');
const replay = JSON.parse(read('replay.json')) as ReplayBundle;
const experiments = parseLines<Experiment>(read('experiments.jsonl'));
const events = parseLines<BackendEvent>(read('events.jsonl'));
const summary = JSON.parse(read('summary.json'));

test('hero hierarchy includes Quality, its accepted proposal, and exact tool receipts', () => {
  const snapshot = buildSnapshot('live-a-7', replay, events, experiments, summary);
  const quality = flatten(snapshot.tree).find(node => node.id === 'designer-quality');
  assert.ok(quality, 'Quality produced the hero champion and must not disappear');
  assert.equal(quality.name, 'Quality designer');
  const champion = quality.children.find(node => node.id === 'g1-quality');
  assert.ok(champion);
  assert.match(champion.output, /Code decision: accepted/);
  assert.match(champion.output, /6083.44/);
  const receiptIds = experiments.find(e => e.candidateId === 'g1-quality')!.toolReceipts!.map(r => r.id);
  assert.equal(champion.children.length, receiptIds.length);
  for (const id of receiptIds) assert.ok(champion.children.some(node => node.output.includes(id)));
  const damage = snapshot.checks.find(check => check.id === 'damaged');
  assert.deepEqual(damage && {actual: damage.actual, passed: damage.passed}, {actual: 4, passed: false});
});

test('hierarchy derives new designer roles from records and keeps hypothesis tests separate', () => {
  const extra = {...experiments.find(e => e.designer === 'quality')!, designer: 'route-repair', candidateId: 'route-repair-1'};
  const snapshot = buildSnapshot('live-a-7', replay, events, [...experiments, extra], summary);
  const team = flatten(snapshot.tree).find(node => node.id === 'designers')!;
  assert.deepEqual(new Set(team.children.map(node => node.id)), new Set(['designer-flow', 'designer-quality', 'designer-capacity', 'designer-route-repair']));
  assert.equal(team.children.find(node => node.id === 'designer-route-repair')!.name, 'Route Repair designer');
  assert.ok(!team.children.some(node => node.id.includes('hypothesis-test')));
});

test('static projection preserves scored layouts and trace counters for the hero', () => {
  const before = JSON.stringify(replay);
  const snapshot = buildSnapshot('live-a-7', replay, events, experiments, summary);
  assert.equal(JSON.stringify(snapshot.replay), before);
  const end = playbackEnd(replay.baseline.result.trace, replay.improved.result.trace);
  for (const side of [replay.baseline, replay.improved]) {
    const frame = frameAt(side.result.trace, side.layout, end);
    assert.equal(frame.shipped, side.result.metrics.shipped);
    assert.equal(frame.damaged, side.result.metrics.damaged);
  }
  assert.equal(replay.improved.select.dodPassed, false);
});

test('all four memory comparisons retain arm names and final-split evidence', () => {
  for (const pair of ['f-r1', 'f-r2', 'g-r1', 'g-r2']) {
    const bundle = JSON.parse(readFileSync(`recorded/memeval-2026-10-17T19-41-04-350Z-factory-${pair}/replay.json`, 'utf8')) as ReplayBundle;
    const snapshot = buildSnapshot(bundle.runId, bundle, [], [], null);
    assert.equal(snapshot.replay!.baseline.column, 'No memory');
    assert.equal(snapshot.replay!.improved.column, 'Shared memory');
    assert.ok(bundle.improved.final!.objective > bundle.baseline.final!.objective);
    assert.equal(snapshot.mode, 'recorded');
  }
});

test('the deployable viewer imports stay within this checkout and require no backend endpoint', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const { resolve, dirname, sep } = await import('node:path');
  const root = resolve('.');
  const walk = (dir: string): string[] => readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() && entry.name !== 'dist' ? walk(`${dir}/${entry.name}`) : entry.isFile() && entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []);
  for (const file of walk('web').filter(file => !file.endsWith('vite.config.ts'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /['"`]\/api\//, `${file} requires a backend API`);
    assert.doesNotMatch(source, /fetch\s*\(\s*['"`]https?:/, `${file} fetches an external origin`);
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1]);
      assert.ok(target.startsWith(root + sep), `${file} imports outside the checkout`);
      assert.ok([target, target + '.ts', target + '.css'].some(path => existsSync(path)), `${file} imports missing ${match[1]}`);
    }
  }
});
