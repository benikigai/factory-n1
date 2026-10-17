import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTaskA } from '../src/tasks/task.ts';
import { makeScenario } from '../src/sim/scenarios.ts';
import { graderHash } from '../src/sim/version.ts';
import { buildingHash, layoutHash } from '../src/training/generate.ts';
import { legalMoveActions, type OptimizerCase } from '../src/training/optimizer-data.ts';
import { applyAction, measureLayout } from '../src/training/optimizer.ts';
import { summarizeV2 } from '../src/training/optimizer-v2-evaluate.ts';
import { MODELS, BASELINES } from './types.ts';
import { buildV2Replays, exportV2Replays, type SavedV2Report } from './replay.ts';

function fixture() {
  // The canonical historical factory is already excluded from the sealed test set.
  const cases: OptimizerCase[] = [], states: SavedV2Report['cases'] = [];
  for (let i = 0; i < 3; i++) {
    const task = loadTaskA(), id = `fixture-${i + 1}`;
    const days = (offset: number) => (['normal', 'peak', 'fragile', 'skewed'] as const).map((profile, j) => ({ profile, seed: 550_000_000 + i * 100 + offset + j, count: 100 }));
    const item: OptimizerCase = { id, split: 'test', buildingId: id, buildingHash: buildingHash(task), geometrySeed: 0, initialLayoutHash: layoutHash(task.initial), task, initial: task.initial, feedbackDays: days(0), finalDays: days(4) };
    cases.push(item);
    const initial = measureLayout(task, item.initial, item.finalDays);
    const improved = legalMoveActions(task, item.initial, 991 + i, 80).map(action => applyAction(task, item.initial, action)).find(layout => measureLayout(task, layout, item.finalDays).objective! < initial.objective!);
    assert.ok(improved);
    for (const arm of [...MODELS, ...BASELINES]) {
      const layout = i === 0 && arm === MODELS[3] || i === 2 && arm === MODELS[0] ? improved : item.initial;
      states.push({ caseId: id, arm, nextRound: 12, stopped: false, layout, history: [], feedback: measureLayout(task, layout, item.feedbackDays), snapshot3: item.initial, accepted: layout === improved ? 1 : 0, invalid: 0, final: { initial, round3: initial, round12: measureLayout(task, layout, item.finalDays) } });
    }
  }
  const overall = summarizeV2({ planHash: 'fixture', casesHash: 'fixture', startedAt: 0, searchFinished: true, terminalReason: null, states }, [], [], cases.length);
  const report: SavedV2Report = { schemaVersion: 2, completed: true, terminalReason: null, planHash: 'fixture', cases: states, overall };
  return { cases, report };
}
const options = () => ({ createdAt: '2026-10-17T00:00:00.000Z', graderHash: graderHash(), mode: 'synthetic' as const });

test('v2 export retains wins, ties and losses plus measured three/twelve snapshots', () => {
  const { cases, report } = fixture(), result = buildV2Replays(report, cases, options());
  assert.equal(result.catalog.cases.length, 3);
  assert.equal(result.replays.size, 12);
  assert.deepEqual(result.catalog.cases.map(item => Math.sign(item.v2VsBasePercent)), [1, 0, -1]);
  assert.equal(result.catalog.defaultCaseId, 'fixture-2');
  assert.equal(result.catalog.mode, 'synthetic');
  for (const item of result.catalog.cases) {
    assert.deepEqual(Object.keys(item.arms).sort(), [...MODELS, ...BASELINES].sort());
    for (const arm of MODELS) assert.deepEqual(item.arms[arm].snapshots.round3, item.initialScore);
  }
});

test('every model and snapshot replays identical demand and exact saved day metrics', () => {
  const { cases, report } = fixture(), result = buildV2Replays(report, cases, options());
  for (const replay of result.replays.values()) {
    const item = cases.find(value => value.id === replay.caseId)!;
    const day = item.finalDays.find(value => value.seed === replay.scenario.seed)!;
    const packages = makeScenario(day.seed, day.profile, day.count).packages;
    for (const arm of MODELS) for (const snapshot of ['round3', 'round12'] as const) {
      const side = replay.arms[arm][snapshot], state = report.cases.find(value => value.caseId === item.id && value.arm === arm)!;
      assert.deepEqual(side.result.scenario, replay.scenario);
      assert.deepEqual(side.result.metrics, state.final![snapshot].days.find(value => value.seed === day.seed)!.metrics);
      const fields = (value: { id: number; arrival: number; size: string; zone: string; fragile: boolean }) => ({ id: value.id, arrival: value.arrival, size: value.size, zone: value.zone, fragile: value.fragile });
      assert.deepEqual(side.result.trace.map(fields), packages.map(fields));
    }
  }
});

test('changed metrics, incomplete evaluations and missing arms fail closed', () => {
  const { cases, report } = fixture();
  assert.throws(() => buildV2Replays({ ...report, completed: false }, cases, options()), /complete evaluation/);
  assert.throws(() => buildV2Replays({ ...report, cases: report.cases.slice(1) }, cases, options()), /every factory/);
  const corrupt = structuredClone(report); corrupt.cases[0].final!.round3.days[0].metrics.damaged++;
  assert.throws(() => buildV2Replays(corrupt, cases, options()), /Saved metric mismatch/);
  const aggregate = structuredClone(report); aggregate.overall[MODELS[0]].snapshots.round12.meanObjective!++;
  assert.throws(() => buildV2Replays(aggregate, cases, options()), /overall/);
});

test('incomplete metrics are rejected before any plan or sealed factory file is read', () => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-v2-incomplete-'));
  try {
    writeFileSync(join(directory, 'metrics.json'), JSON.stringify({ completed: false, terminalReason: 'runtime_cap' }));
    assert.throws(() => exportV2Replays({ evaluationDirectory: directory, dataDirectory: '/nonexistent-sealed-data', outputDirectory: `runs/optimizer-v2-viewer/${Date.now()}` }), /sealed factories were not opened/);
  } finally { rmSync(directory, { recursive: true }); }
});
