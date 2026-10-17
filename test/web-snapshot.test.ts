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

test('run 7 hierarchy retains Quality, its accepted proposal, and exact tool receipts', () => {
  const snapshot = buildSnapshot('live-a-7', replay, events, experiments, summary);
  const quality = flatten(snapshot.tree).find(node => node.id === 'designer-quality');
  assert.ok(quality, 'Quality produced the run 7 champion and must not disappear');
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

test('run 7 projection preserves scored layouts and trace counters', () => {
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

const heroRead = (file: string) => readFileSync(`recorded/live-a-11/${file}`, 'utf8');
const heroReplay = JSON.parse(heroRead('replay.json')) as ReplayBundle;
const heroExperiments = parseLines<Experiment>(heroRead('experiments.jsonl'));
const heroEvents = parseLines<BackendEvent>(heroRead('events.jsonl'));
const heroSummary = JSON.parse(heroRead('summary.json'));

test('run 11 hierarchy derives the Route designer and exposes its accepted champion and ruler receipts', () => {
  const snapshot = buildSnapshot('live-a-11', heroReplay, heroEvents, heroExperiments, heroSummary);
  const team = flatten(snapshot.tree).find(node => node.id === 'designers')!;
  assert.deepEqual(new Set(team.children.map(node => node.id)), new Set(['designer-route', 'designer-quality', 'designer-flow']));
  const route = team.children.find(node => node.id === 'designer-route')!;
  assert.equal(route.name, 'Route designer');
  const champion = route.children.find(node => node.id === heroSummary.champion.id);
  assert.ok(champion);
  assert.equal(champion.id, 'g1-route');
  assert.match(champion.output, /Code decision: accepted/);
  assert.match(champion.output, /3283.44/);
  const receipts = heroExperiments.find(e => e.candidateId === champion.id)!.toolReceipts!;
  assert.ok(receipts.some(receipt => receipt.name === 'measure_legs'));
  assert.equal(champion.children.length, receipts.length);
  for (const receipt of receipts) {
    assert.ok(champion.children.some(node => node.name === receipt.name && node.output.includes(receipt.id)));
  }
  const damage = snapshot.checks.find(check => check.id === 'damaged');
  assert.deepEqual(damage && {actual: damage.actual, passed: damage.passed}, {actual: 0, passed: true});
});

test('run 11 keeps the original baseline and replays its zero-damage champion from scored traces', () => {
  assert.deepEqual(heroReplay.baseline, replay.baseline);
  assert.deepEqual(heroReplay.scenario, replay.scenario);
  const before = JSON.stringify(heroReplay);
  const snapshot = buildSnapshot('live-a-11', heroReplay, heroEvents, heroExperiments, heroSummary);
  assert.equal(JSON.stringify(snapshot.replay), before);
  const end = playbackEnd(heroReplay.baseline.result.trace, heroReplay.improved.result.trace);
  for (const side of [heroReplay.baseline, heroReplay.improved]) {
    const frame = frameAt(side.result.trace, side.layout, end);
    assert.equal(frame.shipped, side.result.metrics.shipped);
    assert.equal(frame.damaged, side.result.metrics.damaged);
  }
  const championFrame = frameAt(heroReplay.improved.result.trace, heroReplay.improved.layout, end);
  assert.equal(championFrame.shipped, 100);
  assert.equal(championFrame.damaged, 0);
  assert.ok(heroReplay.improved.result.trace.every(trace => !trace.missorted && !trace.damaged));
  assert.equal(heroReplay.improved.select.dodPassed, true);
  assert.equal(heroReplay.improved.select.objective, 3283.44);
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
  // Dev-server-only modules: vite.config.ts and live-runner.ts run in Node; run-live.ts is loaded only behind
  // import.meta.env.DEV. scripts/static-guard.ts checks the built output itself for any of this code.
  const devOnly = ['vite.config.ts', 'live-runner.ts', 'run-live.ts'];
  for (const file of walk('web')) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split('\n').filter(l => /import\(['"]\.\/run-live/.test(l))) assert.match(line, /import\.meta\.env\.DEV/, `${file} loads run-live outside a DEV guard`);
  }
  for (const file of walk('web').filter(file => !devOnly.some(name => file.endsWith(name)))) {
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
