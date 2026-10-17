import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { simulate } from '../src/sim/engine.ts';
import { makeScenario } from '../src/sim/scenarios.ts';
import { graderHash, SIM_VERSION } from '../src/sim/version.ts';
import type { Layout, RunResult } from '../src/sim/types.ts';
import type { ReplaySide } from '../src/replay.ts';
import { buildingHash, contentHash, layoutHash } from '../src/training/generate.ts';
import { measureLayout, type OptimizerMeasurement } from '../src/training/optimizer.ts';
import type { OptimizerCase } from '../src/training/optimizer-data.ts';
import type { V2Arm, V2Plan, summarizeV2 } from '../src/training/optimizer-v2-evaluate.ts';
import { MODELS, BASELINES, LABELS, type V2Catalog, type V2Replay, type Snapshot, type SnapshotScore, type Factory, type ArmScore, type Cohort } from './types.ts';

type State = Parameters<typeof summarizeV2>[0]['states'][number] & { continuationExcluded?: boolean };
export interface SavedV2Report {
  schemaVersion: 2;
  completed: boolean;
  terminalReason: string | null;
  planHash: string;
  overall: ReturnType<typeof summarizeV2>;
  cases: State[];
}
export interface SavedContinuationReport {
  schemaVersion: 1;
  completed: boolean;
  terminalReason: string | null;
  primaryFactoryCount: number;
  all20Completed: false;
  excludedFactory: string;
  disclosure: string;
  overall: SavedV2Report['overall'];
  cases: State[];
  accounting: { originalResolvedRequests: number; originalUnknownRequests: number; combinedModelCalls: number };
}
export interface ContinuationManifest {
  approvedContinuation: boolean;
  enginePlanHash: string;
  originalPlanHash: string;
  excludedCase: string;
  includedIds: string[];
  disclosure: string;
}
const ARMS = [...MODELS, ...BASELINES];
const SNAPSHOTS: Snapshot[] = ['round3', 'round12'];
const same = (actual: unknown, expected: unknown, label: string) => { if (!isDeepStrictEqual(actual, expected)) throw new Error(`Saved metric mismatch: ${label}`); };
const score = (measurement: OptimizerMeasurement): SnapshotScore => {
  if (!measurement.valid || !measurement.metrics || measurement.days.length !== 4) throw new Error('Expected four valid measured final days');
  return { metrics: measurement.metrics, goalMet: measurement.goalMet, zeroDamage: measurement.days.every(day => day.metrics.damaged === 0) };
};
const percent = (base: number, value: number) => base ? (base - value) / base * 100 : value ? (() => { throw new Error('Cannot compare against zero objective'); })() : 0;

function side(label: string, layout: Layout, result: RunResult, measured: OptimizerMeasurement): ReplaySide {
  const final = score(measured), split = { objective: final.metrics.objective, dodPassed: final.goalMet };
  return { label, column: label, layout, result, train: split, select: split, final: { ...split, zeroDamage: final.zeroDamage, allShipped: measured.days.every(day => day.metrics.unshipped === 0), damagedTotal: measured.days.reduce((sum, day) => sum + day.metrics.damaged, 0), scenarios: measured.days.length } };
}

export function buildV2Replays(report: SavedV2Report, cases: OptimizerCase[], options: { createdAt: string; graderHash: string; mode?: 'recorded' | 'synthetic'; sourceHashes?: Record<string, string>; models?: V2Catalog['models']; cohort?: Cohort }) {
  if (!report.completed || report.terminalReason !== null) throw new Error('A complete evaluation is required before opening replay factories');
  if (report.cases.some(state => state.continuationExcluded)) throw new Error('Internal skipped-factory metrics are not a completed comparison');
  if (options.graderHash !== graderHash()) throw new Error('Grader hash differs from completed evaluation');
  if (!cases.length || new Set(cases.map(item => item.id)).size !== cases.length || report.cases.length !== cases.length * ARMS.length) throw new Error('Replay must retain every factory and all six arms');
  const cohort: Cohort = options.cohort ?? { kind: 'completed', originalFactories: cases.length, includedFactories: cases.length, excludedFactories: [], disclosure: 'All factories in this evaluation are included.' };
  if (cohort.includedFactories !== cases.length || cohort.originalFactories !== cases.length + cohort.excludedFactories.length || cohort.excludedFactories.some(excluded => cases.some(item => item.id === excluded.id))) throw new Error('Cohort count or excluded-factory mismatch');
  if (cohort.kind === 'completed' && cohort.excludedFactories.length) throw new Error('Excluded factories require explicit continuation mode');
  if (cohort.kind === 'continuation' && (cohort.originalFactories !== 20 || cases.length !== 19 || cohort.excludedFactories.length !== 1)) throw new Error('Continuation must report 19 included factories from the original 20');
  const factories: Factory[] = [];
  const states = new Map<string, Record<V2Arm, State>>();
  for (const item of cases) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || buildingHash(item.task) !== item.buildingHash || layoutHash(item.initial) !== item.initialLayoutHash) throw new Error('Factory identity changed');
    if (item.finalDays.length !== 4 || new Set(item.finalDays.map(day => day.profile)).size !== 4 || new Set([...item.feedbackDays, ...item.finalDays].map(day => day.seed)).size !== 8) throw new Error('Expected four distinct final profiles and separate feedback seeds');
    const initial = measureLayout(item.task, item.initial, item.finalDays);
    const saved = {} as Record<V2Arm, State>, arms = {} as Record<V2Arm, ArmScore>;
    for (const arm of ARMS) {
      const matches = report.cases.filter(state => state.caseId === item.id && state.arm === arm);
      if (matches.length !== 1) throw new Error(`Missing or duplicate ${arm} state`);
      const state = matches[0];
      if (!state.final || !state.snapshot3 || !state.feedback || (!state.stopped && state.nextRound !== 12)) throw new Error(`Incomplete ${arm} state`);
      same(initial, state.final.initial, `${item.id}/${arm}/initial`);
      same(measureLayout(item.task, state.snapshot3, item.finalDays), state.final.round3, `${item.id}/${arm}/round3`);
      same(measureLayout(item.task, state.layout, item.finalDays), state.final.round12, `${item.id}/${arm}/round12`);
      same(measureLayout(item.task, state.layout, item.feedbackDays), state.feedback, `${item.id}/${arm}/feedback`);
      saved[arm] = state;
      arms[arm] = { snapshots: { round3: score(state.final.round3), round12: score(state.final.round12) }, accepted: state.accepted, invalid: state.invalid, attempted: state.nextRound, stopped: state.stopped, planningSimulations: state.teacher?.feedbackSimulationCalls ?? 0, planningMs: state.teacherMs ?? 0 };
    }
    states.set(item.id, saved);
    factories.push({ id: item.id, buildingHash: item.buildingHash, initial: item.initial, initialScore: score(initial), arms, v2VsBasePercent: percent(arms[MODELS[0]].snapshots.round12.metrics.objective, arms[MODELS[3]].snapshots.round12.metrics.objective), replays: item.finalDays.map(day => ({ profile: day.profile, seed: day.seed, file: `${item.id}-${day.profile}.json` })) });
  }
  const aggregate = {} as V2Catalog['aggregate'];
  for (const arm of ARMS) {
    aggregate[arm] = {} as V2Catalog['aggregate'][V2Arm];
    for (const snapshot of SNAPSHOTS) {
      const values = factories.map(factory => factory.arms[arm].snapshots[snapshot]);
      const result = { meanObjective: values.reduce((sum, value) => sum + value.metrics.objective, 0) / values.length, meanDamaged: values.reduce((sum, value) => sum + value.metrics.damaged, 0) / values.length, goalPasses: values.filter(value => value.goalMet).length, zeroDamage: values.filter(value => value.zeroDamage).length, improvements: values.filter((value, i) => value.metrics.objective < factories[i].initialScore.metrics.objective).length };
      const saved = report.overall[arm]?.snapshots[snapshot];
      for (const key of ['meanObjective', 'goalPasses', 'zeroDamage', 'improvements'] as const) same(result[key], saved?.[key], `overall/${arm}/${snapshot}/${key}`);
      same(saved?.scored, factories.length, `overall/${arm}/${snapshot}/scored`);
      same(saved?.missing, 0, `overall/${arm}/${snapshot}/missing`);
      aggregate[arm][snapshot] = result;
    }
  }
  factories.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const representative = [...factories].sort((a, b) => a.v2VsBasePercent - b.v2VsBasePercent || a.id.localeCompare(b.id))[Math.floor(factories.length / 2)];
  const catalog: V2Catalog = { schemaVersion: 2, mode: options.mode ?? 'recorded', createdAt: options.createdAt, graderHash: options.graderHash, simVersion: SIM_VERSION, defaultCaseId: representative.id, selectionRule: 'Upper-middle factory after sorting all included cases by v2 versus base percentage improvement at twelve proposals; ties break by ID. Includes wins, losses and ties.', scope: 'Scores average the same four final demand days. Each animation shows one shared day at a retained three- or twelve-proposal snapshot. Legacy renderer train/select slots hold the final aggregate score, not additional evidence. Model arms share proposal budgets; procedural baselines are separately labeled.', cases: factories, aggregate, models: options.models ?? {}, sourceHashes: options.sourceHashes ?? {}, cohort };
  const replays = new Map<string, V2Replay>();
  for (const item of cases) for (const day of item.finalDays) {
    const saved = states.get(item.id)!, scenario = makeScenario(day.seed, day.profile, day.count);
    const run = (layout: Layout, measured: OptimizerMeasurement, label: string) => {
      const result = simulate(layout, scenario);
      same(result.metrics, measured.days.find(value => value.seed === day.seed && value.profile === day.profile)?.metrics, `${item.id}/${label}/${day.seed}`);
      return side(label, layout, result, measured);
    };
    const arms = {} as V2Replay['arms'];
    for (const model of MODELS) arms[model] = { round3: run(saved[model].snapshot3!, saved[model].final!.round3, LABELS[model]), round12: run(saved[model].layout, saved[model].final!.round12, LABELS[model]) };
    replays.set(`${item.id}-${day.profile}.json`, { caseId: item.id, scenario: { id: scenario.id, seed: scenario.seed, profile: scenario.profile }, initial: run(item.initial, saved[MODELS[0]].final!.initial, 'Initial factory'), arms });
  }
  if (graderHash() !== options.graderHash) throw new Error('Grader changed during replay export');
  return { catalog, replays };
}

export function normalizeContinuation(report: SavedContinuationReport, manifest: ContinuationManifest): { report: SavedV2Report; cohort: Cohort } {
  if (report.schemaVersion !== 1 || !report.completed || report.terminalReason !== null) throw new Error('Continuation is incomplete; sealed factories were not opened');
  if (!manifest.approvedContinuation || manifest.excludedCase !== 'optimizer-v2-test-building-11' || manifest.excludedCase !== report.excludedFactory || manifest.disclosure !== report.disclosure || report.primaryFactoryCount !== 19 || report.all20Completed !== false || manifest.includedIds.length !== 19 || new Set(manifest.includedIds).size !== 19 || manifest.includedIds.includes(manifest.excludedCase)) throw new Error('Invalid 19-of-20 continuation disclosure or selection');
  if (report.cases.length !== 19 * ARMS.length || report.cases.some(state => state.continuationExcluded || !manifest.includedIds.includes(state.caseId)) || new Set(report.cases.map(state => state.caseId)).size !== 19) throw new Error('Continuation headline states must include exactly the same 19 factories');
  return {
    report: { schemaVersion: 2, completed: true, terminalReason: null, planHash: manifest.enginePlanHash, overall: report.overall, cases: report.cases },
    cohort: { kind: 'continuation', originalFactories: 20, includedFactories: 19, excludedFactories: [{ id: manifest.excludedCase, reason: 'Infrastructure interruption with an unresolved request; excluded from every headline arm.' }], disclosure: report.disclosure, originalResolvedRequests: report.accounting.originalResolvedRequests, originalUnknownRequests: report.accounting.originalUnknownRequests, combinedModelCalls: report.accounting.combinedModelCalls },
  };
}

export function exportV2Replays(options: { evaluationDirectory: string; dataDirectory?: string; outputDirectory?: string; mode?: 'completed' | 'continuation' }) {
  const evaluation = resolve(options.evaluationDirectory), data = resolve(options.dataDirectory ?? 'runs/optimizer-data/v2'), output = resolve(options.outputDirectory ?? 'runs/optimizer-v2-viewer/data');
  if (!output.startsWith(resolve('runs/optimizer-v2-viewer') + '/') || existsSync(output)) throw new Error('Use a new output directory inside runs/optimizer-v2-viewer/');
  // Check completion before even reading the plan or held-out dataset.
  const continuation = options.mode === 'continuation';
  const metricsText = readFileSync(join(evaluation, continuation ? 'continuation-results.json' : 'metrics.json'), 'utf8');
  const parsed = JSON.parse(metricsText) as SavedV2Report | SavedContinuationReport;
  if (!parsed.completed || parsed.terminalReason !== null) throw new Error('Evaluation is incomplete; sealed factories were not opened');
  let report: SavedV2Report, cohort: Cohort | undefined, includedIds: string[] | undefined, originalPlanHash: string | undefined;
  const extraHashes: Record<string, string> = {};
  if (continuation) {
    const manifestText = readFileSync(join(evaluation, 'continuation-manifest.json'), 'utf8'), manifest = JSON.parse(manifestText) as ContinuationManifest;
    ({ report, cohort } = normalizeContinuation(parsed as SavedContinuationReport, manifest));
    includedIds = manifest.includedIds;
    originalPlanHash = manifest.originalPlanHash;
    const originalPlanText = readFileSync(join(evaluation, 'origin/evaluation-plan.json'), 'utf8');
    if (contentHash(JSON.parse(originalPlanText)) !== manifest.originalPlanHash) throw new Error('Original plan hash differs from continuation manifest');
    extraHashes.continuationManifest = contentHash(manifestText); extraHashes.originalPlan = contentHash(originalPlanText);
  } else {
    if (parsed.schemaVersion !== 2) throw new Error('Use explicit continuation mode for a continuation result');
    report = parsed as SavedV2Report;
  }
  const planText = readFileSync(join(evaluation, continuation ? 'engine/evaluation-plan.json' : 'evaluation-plan.json'), 'utf8');
  const plan = JSON.parse(planText) as V2Plan & { continuation?: { excludedCase: string; originalPlanHash: string } };
  if (contentHash(plan) !== report.planHash || plan.factoryLimit !== 20) throw new Error('Evaluation plan hash or original factory count differs');
  if (!continuation && plan.continuation) throw new Error('Internal continuation metrics cannot be exported as a completed 20-factory evaluation');
  if (continuation && (plan.continuation?.excludedCase !== cohort!.excludedFactories[0].id || plan.continuation.originalPlanHash !== originalPlanHash)) throw new Error('Engine continuation provenance differs from headline report');
  const casesText = readFileSync(join(data, 'test-factories.jsonl'), 'utf8');
  if (contentHash(casesText) !== plan.datasetHash || Buffer.byteLength(casesText) !== plan.datasetBytes) throw new Error('Held-out dataset bytes differ from evaluation');
  const allCases = casesText.trim().split('\n').map(line => JSON.parse(line) as OptimizerCase).sort((a, b) => a.id.localeCompare(b.id));
  if (allCases.length !== 20) throw new Error('Expected twenty original factories');
  const cases = includedIds ? allCases.filter(item => includedIds.includes(item.id)) : allCases;
  if (includedIds && (cases.length !== 19 || allCases.filter(item => !includedIds.includes(item.id)).some(item => item.id !== cohort!.excludedFactories[0].id))) throw new Error('Dataset does not match the continuation selection');
  const sourceHashes = { metrics: contentHash(metricsText), plan: contentHash(planText), testFactories: contentHash(casesText), ...extraHashes };
  const result = buildV2Replays(report, cases, { createdAt: new Date().toISOString(), graderHash: plan.graderHash, sourceHashes, models: plan.provenance?.models, cohort });
  mkdirSync(output, { recursive: true });
  for (const [file, replay] of result.replays) writeFileSync(join(output, file), JSON.stringify(replay) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'catalog.json'), JSON.stringify(result.catalog, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'replay-export-receipt.json'), JSON.stringify({ verified: true, cohort: result.catalog.cohort, factories: cases.length, scenarioFiles: result.replays.size, modelSnapshotTraces: cases.length * 4 * 4 * 2, graderHash: plan.graderHash, sourceHashes }, null, 2) + '\n', { flag: 'wx' });
  return { output, factories: cases.length, scenarioFiles: result.replays.size, defaultCaseId: result.catalog.defaultCaseId };
}
