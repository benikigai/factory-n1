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
import { MODELS, BASELINES, LABELS, type V2Catalog, type V2Replay, type Snapshot, type SnapshotScore, type Factory, type ArmScore } from './types.ts';

type State = Parameters<typeof summarizeV2>[0]['states'][number];
export interface SavedV2Report {
  schemaVersion: 2;
  completed: boolean;
  terminalReason: string | null;
  planHash: string;
  overall: ReturnType<typeof summarizeV2>;
  cases: State[];
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

export function buildV2Replays(report: SavedV2Report, cases: OptimizerCase[], options: { createdAt: string; graderHash: string; mode?: 'recorded' | 'synthetic'; sourceHashes?: Record<string, string>; models?: V2Catalog['models'] }) {
  if (!report.completed || report.terminalReason !== null) throw new Error('A complete evaluation is required before opening replay factories');
  if (options.graderHash !== graderHash()) throw new Error('Grader hash differs from completed evaluation');
  if (!cases.length || new Set(cases.map(item => item.id)).size !== cases.length || report.cases.length !== cases.length * ARMS.length) throw new Error('Replay must retain every factory and all six arms');
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
  const catalog: V2Catalog = { schemaVersion: 2, mode: options.mode ?? 'recorded', createdAt: options.createdAt, graderHash: options.graderHash, simVersion: SIM_VERSION, defaultCaseId: representative.id, selectionRule: 'Upper-middle factory after sorting all cases by v2 versus base percentage improvement at twelve proposals; ties break by ID. Includes wins, losses and ties.', scope: 'Scores average the same four final demand days. Each animation shows one shared day at a retained three- or twelve-proposal snapshot. Legacy renderer train/select slots hold the final aggregate score, not additional evidence. Model arms share proposal budgets; procedural baselines are separately labeled.', cases: factories, aggregate, models: options.models ?? {}, sourceHashes: options.sourceHashes ?? {} };
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

export function exportV2Replays(options: { evaluationDirectory: string; dataDirectory?: string; outputDirectory?: string }) {
  const evaluation = resolve(options.evaluationDirectory), data = resolve(options.dataDirectory ?? 'runs/optimizer-data/v2'), output = resolve(options.outputDirectory ?? 'runs/optimizer-v2-viewer/data');
  if (!output.startsWith(resolve('runs/optimizer-v2-viewer') + '/') || existsSync(output)) throw new Error('Use a new output directory inside runs/optimizer-v2-viewer/');
  // Check completion before even reading the plan or held-out dataset.
  const metricsText = readFileSync(join(evaluation, 'metrics.json'), 'utf8'), report = JSON.parse(metricsText) as SavedV2Report;
  if (!report.completed || report.terminalReason !== null) throw new Error('Evaluation is incomplete; sealed factories were not opened');
  const planText = readFileSync(join(evaluation, 'evaluation-plan.json'), 'utf8'), plan = JSON.parse(planText) as V2Plan;
  if (contentHash(plan) !== report.planHash || plan.factoryLimit !== 20) throw new Error('Expected the completed all-20-factory evaluation plan');
  const casesText = readFileSync(join(data, 'test-factories.jsonl'), 'utf8');
  if (contentHash(casesText) !== plan.datasetHash || Buffer.byteLength(casesText) !== plan.datasetBytes) throw new Error('Held-out dataset bytes differ from evaluation');
  const cases = casesText.trim().split('\n').map(line => JSON.parse(line) as OptimizerCase).sort((a, b) => a.id.localeCompare(b.id));
  if (cases.length !== 20) throw new Error('Expected all twenty factories');
  const sourceHashes = { metrics: contentHash(metricsText), plan: contentHash(planText), testFactories: contentHash(casesText) };
  const result = buildV2Replays(report, cases, { createdAt: new Date().toISOString(), graderHash: plan.graderHash, sourceHashes, models: plan.provenance?.models });
  mkdirSync(output, { recursive: true });
  for (const [file, replay] of result.replays) writeFileSync(join(output, file), JSON.stringify(replay) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'catalog.json'), JSON.stringify(result.catalog, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'replay-export-receipt.json'), JSON.stringify({ verified: true, factories: cases.length, scenarioFiles: result.replays.size, modelSnapshotTraces: cases.length * 4 * 4 * 2, graderHash: plan.graderHash, sourceHashes }, null, 2) + '\n', { flag: 'wx' });
  return { output, factories: cases.length, scenarioFiles: result.replays.size, defaultCaseId: result.catalog.defaultCaseId };
}
