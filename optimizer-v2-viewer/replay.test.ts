import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTaskA } from '../src/tasks/task.ts';
import { makeScenario } from '../src/sim/scenarios.ts';
import { graderHash } from '../src/sim/version.ts';
import { buildingHash, contentHash, layoutHash } from '../src/training/generate.ts';
import { legalMoveActions, type OptimizerCase } from '../src/training/optimizer-data.ts';
import { applyAction, measureLayout } from '../src/training/optimizer.ts';
import { summarizeV2 } from '../src/training/optimizer-v2-evaluate.ts';
import { MODELS, BASELINES } from './types.ts';
import { buildV2Replays, exportV2Replays, normalizeContinuation, type SavedV2Report, type SavedContinuationReport, type ContinuationManifest } from './replay.ts';

function fixture(ids = ['fixture-1', 'fixture-2', 'fixture-3']) {
  // The canonical historical factory is already excluded from the sealed test set.
  const cases: OptimizerCase[] = [], states: SavedV2Report['cases'] = [];
  for (let i = 0; i < ids.length; i++) {
    const task = loadTaskA(), id = ids[i];
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
  assert.equal(result.catalog.cohort.kind, 'completed');
  assert.equal(result.catalog.cohort.excludedFactories.length, 0);
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

test('continuation retains exactly nineteen factories and preserves the original twenty-factory disclosure', () => {
  const excluded = 'optimizer-v2-test-building-11';
  const ids = Array.from({ length: 20 }, (_, i) => `optimizer-v2-test-building-${i + 1}`).filter(id => id !== excluded);
  const { cases, report } = fixture(ids);
  const manifest: ContinuationManifest = { approvedContinuation: true, enginePlanHash: 'engine', originalPlanHash: 'original', includedIds: ids, excludedCase: excluded, disclosure: 'Infrastructure-only continuation after partial final metrics were examined.' };
  const continuation: SavedContinuationReport = { schemaVersion: 1, completed: true, terminalReason: null, primaryFactoryCount: 19, all20Completed: false, excludedFactory: excluded, disclosure: manifest.disclosure, overall: report.overall, cases: report.cases, accounting: { originalResolvedRequests: 93, originalUnknownRequests: 1, combinedModelCalls: 200 } };
  const normalized = normalizeContinuation(continuation, manifest);
  const result = buildV2Replays(normalized.report, cases, { ...options(), cohort: normalized.cohort });
  assert.equal(result.catalog.cohort.kind, 'continuation');
  assert.equal(result.catalog.cohort.originalFactories, 20);
  assert.equal(result.catalog.cohort.includedFactories, 19);
  assert.equal(result.catalog.cohort.originalUnknownRequests, 1);
  assert.equal(result.catalog.cohort.excludedFactories[0].id, excluded);
  assert.equal(result.catalog.cases.some(item => item.id === excluded), false);
  assert.equal(result.replays.size, 76);
  assert.throws(() => normalizeContinuation({ ...continuation, primaryFactoryCount: 20 }, manifest), /Invalid 19-of-20/);
  assert.throws(() => normalizeContinuation({ ...continuation, completed: false }, manifest), /incomplete/);
  const corrupted = structuredClone(continuation); corrupted.cases[0].caseId = excluded;
  assert.throws(() => normalizeContinuation(corrupted, manifest), /exactly the same 19/);
});

test('internal skipped-twentieth states and engine reports cannot become normal completed results', () => {
  const { cases, report } = fixture();
  const corrupt = structuredClone(report); corrupt.cases[0].continuationExcluded = true;
  assert.throws(() => buildV2Replays(corrupt, cases, options()), /Internal skipped-factory/);
  const directory = mkdtempSync(join(tmpdir(), 'factory-v2-engine-'));
  try {
    const plan = { factoryLimit: 20, continuation: { excludedCase: 'optimizer-v2-test-building-11', originalPlanHash: 'original' } };
    writeFileSync(join(directory, 'metrics.json'), JSON.stringify({ ...report, planHash: contentHash(plan) }));
    writeFileSync(join(directory, 'evaluation-plan.json'), JSON.stringify(plan));
    assert.throws(() => exportV2Replays({ evaluationDirectory: directory, dataDirectory: '/nonexistent-sealed-data', outputDirectory: `runs/optimizer-v2-viewer/engine-${Date.now()}` }), /cannot be exported as a completed 20-factory/);
  } finally { rmSync(directory, { recursive: true }); }
});

test('filesystem exports support completed twenty and disclosed nineteen, using synthetic files only', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `optimizer-v2-test-building-${i + 1}`).sort();
  const { cases, report } = fixture(ids), excluded = 'optimizer-v2-test-building-11';
  const directory = mkdtempSync(join(tmpdir(), 'factory-v2-export-'));
  const suffix = directory.split('/').at(-1)!;
  const normalOutput = `runs/optimizer-v2-viewer/${suffix}-normal`, continuationOutput = `runs/optimizer-v2-viewer/${suffix}-continuation`;
  try {
    for (const path of ['data', 'origin', 'engine']) mkdirSync(join(directory, path));
    const casesText = cases.map(item => JSON.stringify(item)).join('\n') + '\n';
    writeFileSync(join(directory, 'data/test-factories.jsonl'), casesText);
    const originalPlan = { factoryLimit: 20, datasetHash: contentHash(casesText), datasetBytes: Buffer.byteLength(casesText), graderHash: graderHash() };
    writeFileSync(join(directory, 'origin/evaluation-plan.json'), JSON.stringify(originalPlan));
    writeFileSync(join(directory, 'origin/metrics.json'), JSON.stringify({ ...report, planHash: contentHash(originalPlan) }));
    const normal = exportV2Replays({ evaluationDirectory: join(directory, 'origin'), dataDirectory: join(directory, 'data'), outputDirectory: normalOutput });
    assert.equal(normal.factories, 20); assert.equal(normal.scenarioFiles, 80);
    const originalCatalog = JSON.parse(readFileSync(join(normalOutput, 'catalog.json'), 'utf8'));
    assert.equal(originalCatalog.cohort.kind, 'completed');

    const plan = { ...originalPlan, continuation: { excludedCase: excluded, originalPlanHash: contentHash(originalPlan) } };
    const includedIds = ids.filter(id => id !== excluded), states = report.cases.filter(state => state.caseId !== excluded);
    const overall = summarizeV2({ planHash: 'synthetic', casesHash: 'synthetic', startedAt: 0, searchFinished: true, terminalReason: null, states }, [], [], 19);
    const manifest: ContinuationManifest = { approvedContinuation: true, enginePlanHash: contentHash(plan), originalPlanHash: contentHash(originalPlan), includedIds, excludedCase: excluded, disclosure: 'Synthetic continuation fixture. Infrastructure interruption after partial results were examined.' };
    const continuation: SavedContinuationReport = { schemaVersion: 1, completed: true, terminalReason: null, primaryFactoryCount: 19, all20Completed: false, excludedFactory: excluded, disclosure: manifest.disclosure, overall, cases: states, accounting: { originalResolvedRequests: 93, originalUnknownRequests: 1, combinedModelCalls: 200 } };
    writeFileSync(join(directory, 'engine/evaluation-plan.json'), JSON.stringify(plan));
    writeFileSync(join(directory, 'continuation-manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(directory, 'continuation-results.json'), JSON.stringify(continuation));
    const result = exportV2Replays({ evaluationDirectory: directory, dataDirectory: join(directory, 'data'), outputDirectory: continuationOutput, mode: 'continuation' });
    assert.equal(result.factories, 19); assert.equal(result.scenarioFiles, 76);
    const catalog = JSON.parse(readFileSync(join(continuationOutput, 'catalog.json'), 'utf8'));
    assert.equal(catalog.cohort.kind, 'continuation');
    assert.equal(catalog.cohort.originalFactories, 20);
    assert.equal(catalog.cohort.includedFactories, 19);
    assert.equal(catalog.cases.some((item: { id: string }) => item.id === excluded), false);
  } finally {
    rmSync(directory, { recursive: true });
    rmSync(normalOutput, { recursive: true, force: true });
    rmSync(continuationOutput, { recursive: true, force: true });
  }
});
