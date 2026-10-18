import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ReplayBundle, ReplaySide } from "../replay.ts";
import { simulate } from "../sim/engine.ts";
import { makeScenario } from "../sim/scenarios.ts";
import type { Layout, Profile, RunResult } from "../sim/types.ts";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import { buildingHash, contentHash, layoutHash } from "./generate.ts";
import { measureLayout, type OptimizerMeasurement } from "./optimizer.ts";
import type { OptimizerCase } from "./optimizer-data.ts";
import { summarizeOptimizerResults, type runOptimizerEvaluation } from "./optimizer-evaluate.ts";

export type OptimizerSavedReport = Awaited<ReturnType<typeof runOptimizerEvaluation>>;
type SavedState = OptimizerSavedReport["cases"][number];
type Metrics = NonNullable<OptimizerMeasurement["metrics"]>;

export interface CatalogArm {
  layout: Layout;
  initialMetrics: Metrics;
  finalMetrics: Metrics;
  goalMet: boolean;
  zeroDamage: boolean;
  initialGoalMet: boolean;
  initialZeroDamage: boolean;
  checks: OptimizerMeasurement["checks"];
  acceptedMoves: number;
  invalidActions: number;
  attemptedProposals: number;
  status: string;
  objectiveImprovementPercent: number;
}
export interface CatalogCase {
  id: string;
  buildingHash: string;
  initialLayout: Layout;
  initialMetrics: Metrics;
  base: CatalogArm;
  tuned: CatalogArm;
  random: CatalogArm;
  comparison: { tunedVsBasePercent: number; tunedMinusBaseObjective: number; outcome: "tuned" | "base" | "tie" };
  replays: { profile: Profile; seed: number; scenarioId: string; file: string }[];
}
export interface Catalog {
  schemaVersion: 1;
  createdAt: string;
  defaultCaseId: string;
  defaultProfile: Profile;
  selectionRule: string;
  metricsScope: string;
  graderHash: string;
  simVersion: string;
  sourceHashes: Record<string, string>;
  overall: OptimizerSavedReport["overall"];
  pairedWins: OptimizerSavedReport["pairedWins"];
  cases: CatalogCase[];
  evidenceFiles: string[];
}
export interface OptimizerReplay extends ReplayBundle {
  optimizer: {
    caseId: string;
    scope: "one-final-demand-day";
    aggregateScope: "four-final-demand-days";
    tunedVsBasePercent: number;
    aggregate: CatalogCase;
    legacyScoreScope: string;
    initial: ReplaySide;
  };
}

const ARMS = ["base", "tuned", "random"] as const;
function gainPercent(baseline: number, candidate: number) {
  if (baseline === 0) {
    if (candidate === 0) return 0;
    throw new Error("Cannot calculate percentage gain from zero baseline");
  }
  return (baseline - candidate) / baseline * 100;
}

function requireSame(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Saved metric mismatch: ${label}`);
}

function catalogArm(state: SavedState): CatalogArm {
  const initial = state.initialFinal!, final = state.championFinal!;
  return {
    layout: state.layout, initialMetrics: initial.metrics!, finalMetrics: final.metrics!,
    goalMet: final.goalMet, zeroDamage: final.days.every(day => day.metrics.damaged === 0),
    initialGoalMet: initial.goalMet, initialZeroDamage: initial.days.every(day => day.metrics.damaged === 0), checks: final.checks,
    acceptedMoves: state.acceptedMoves, invalidActions: state.invalidActions, attemptedProposals: state.attemptedProposals, status: state.status,
    objectiveImprovementPercent: gainPercent(initial.objective!, final.objective!),
  };
}

function replaySide(label: string, layout: Layout, result: RunResult, feedback: OptimizerMeasurement, final: OptimizerMeasurement): ReplaySide {
  const score = { objective: feedback.objective!, dodPassed: feedback.goalMet };
  return {
    label, column: label, layout, result, train: score, select: score,
    final: { objective: final.objective!, dodPassed: final.goalMet, zeroDamage: final.days.every(day => day.metrics.damaged === 0), allShipped: final.days.every(day => day.metrics.unshipped === 0), damagedTotal: final.days.reduce((sum, day) => sum + day.metrics.damaged, 0), scenarios: final.days.length },
  };
}

/** Recreate traces only after every saved final result has been checked against the unchanged simulator. */
export function buildOptimizerReplays(report: OptimizerSavedReport, cases: OptimizerCase[], options: { createdAt: string; graderHash: string; sourceHashes?: Record<string, string>; evidenceFiles?: string[] }) {
  cases = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  if (options.graderHash !== graderHash()) throw new Error("Grader hash differs from saved evaluation");
  if (!report.completed || report.incompletePairs !== 0 || !cases.length || new Set(cases.map(item => item.id)).size !== cases.length) throw new Error("Replay requires a complete evaluation with unique factories");
  if (report.cases.length !== cases.length * ARMS.length || report.pairedCases !== cases.length) throw new Error("Replay must include every evaluated factory and all three arms");
  const catalogCases: CatalogCase[] = [];
  const verified = new Map<string, { item: OptimizerCase; states: Record<typeof ARMS[number], SavedState> }>();
  for (const item of cases) {
    if (!/^[a-z0-9-]+$/.test(item.id) || buildingHash(item.task) !== item.buildingHash || layoutHash(item.initial) !== item.initialLayoutHash) throw new Error(`Factory identity mismatch: ${item.id}`);
    if (item.finalDays.length !== 4 || new Set(item.finalDays.map(day => day.profile)).size !== 4 || new Set(item.finalDays.map(day => day.seed)).size !== 4) throw new Error(`Factory must contain four distinct final profiles: ${item.id}`);
    const initial = measureLayout(item.task, item.initial, item.finalDays);
    const states = {} as Record<typeof ARMS[number], SavedState>;
    for (const arm of ARMS) {
      const matching = report.cases.filter(state => state.caseId === item.id && state.arm === arm);
      if (matching.length !== 1) throw new Error(`Missing or duplicate ${arm} state for ${item.id}`);
      const state = matching[0];
      if (!state.initialFinal?.metrics || !state.championFinal?.metrics || !state.feedback?.metrics || !["complete", "stopped"].includes(state.status)) throw new Error(`Incomplete ${arm} results for ${item.id}`);
      requireSame(initial, state.initialFinal, `${item.id}/${arm}/initial-final`);
      requireSame(measureLayout(item.task, state.layout, item.finalDays), state.championFinal, `${item.id}/${arm}/champion-final`);
      requireSame(measureLayout(item.task, state.layout, item.feedbackDays), state.feedback, `${item.id}/${arm}/feedback`);
      states[arm] = state;
    }
    const base = catalogArm(states.base), tuned = catalogArm(states.tuned), random = catalogArm(states.random);
    const difference = tuned.finalMetrics.objective - base.finalMetrics.objective;
    catalogCases.push({
      id: item.id, buildingHash: item.buildingHash, initialLayout: item.initial, initialMetrics: initial.metrics!, base, tuned, random,
      comparison: { tunedVsBasePercent: gainPercent(base.finalMetrics.objective, tuned.finalMetrics.objective), tunedMinusBaseObjective: difference, outcome: difference < 0 ? "tuned" : difference > 0 ? "base" : "tie" },
      replays: item.finalDays.map(day => ({ profile: day.profile, seed: day.seed, scenarioId: `${day.profile}-${day.seed}`, file: `${item.id}-${day.profile}.json` })),
    });
    verified.set(item.id, { item, states });
  }
  const budgets = { base: report.overall.base.budget, tuned: report.overall.tuned.budget, random: report.overall.random.budget };
  const summary = summarizeOptimizerResults(cases, report.cases, budgets);
  for (const key of ["overall", "pairedWins", "pairedCases", "pairs", "pairedGoalWins", "pairedZeroDamageWins"] as const) requireSame(summary[key], report[key], `summary/${key}`);
  catalogCases.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const representative = [...catalogCases].sort((a, b) => a.comparison.tunedVsBasePercent - b.comparison.tunedVsBasePercent || a.id.localeCompare(b.id))[Math.floor(catalogCases.length / 2)];
  const catalog: Catalog = {
    schemaVersion: 1, createdAt: options.createdAt, defaultCaseId: representative.id, defaultProfile: representative.replays[0].profile,
    selectionRule: "Sort all evaluated factories by percentage objective reduction of tuned versus base, ascending; select index floor(N/2), the upper middle for even N; break ties by factory id. No win filtering.",
    metricsScope: "Catalog metrics aggregate all four held-out final demand days. Each 3D replay animates one of those same days. Positive tunedVsBasePercent means lower objective for the tuned optimizer; it does not establish goal completion.",
    graderHash: options.graderHash, simVersion: SIM_VERSION, sourceHashes: options.sourceHashes ?? {}, overall: report.overall, pairedWins: report.pairedWins, cases: catalogCases, evidenceFiles: options.evidenceFiles ?? [],
  };
  const replays = new Map<string, OptimizerReplay>();
  for (const entry of catalogCases) {
    const { item, states } = verified.get(entry.id)!;
    for (const day of item.finalDays) {
      const scenario = makeScenario(day.seed, day.profile, day.count);
      const initialResult = simulate(item.initial, scenario);
      const baseResult = simulate(states.base.layout, scenario), tunedResult = simulate(states.tuned.layout, scenario);
      for (const [arm, result] of [["base", baseResult], ["tuned", tunedResult]] as const) {
        const saved = states[arm].championFinal!.days.find(savedDay => savedDay.seed === day.seed && savedDay.profile === day.profile);
        requireSame(result.metrics, saved?.metrics, `${item.id}/${arm}/${scenario.id}`);
      }
      const initialSaved = states.base.initialFinal!.days.find(savedDay => savedDay.seed === day.seed && savedDay.profile === day.profile);
      requireSame(initialResult.metrics, initialSaved?.metrics, `${item.id}/initial/${scenario.id}`);
      const replay: OptimizerReplay = {
        runId: `${item.id}-${day.profile}`, mode: "recorded", createdAt: options.createdAt, simVersion: SIM_VERSION, graderHash: options.graderHash,
        task: { id: item.id, goal: item.task.goal }, scenario: { id: scenario.id, seed: scenario.seed, profile: scenario.profile },
        baseline: replaySide("Base Nemotron 8B", states.base.layout, baseResult, states.base.feedback!, states.base.championFinal!),
        improved: replaySide("Fine-tuned optimizer", states.tuned.layout, tunedResult, states.tuned.feedback!, states.tuned.championFinal!),
        comparators: [], accepted: [], rejected: [], lessons: [], curve: [], usage: { calls: states.base.attemptedProposals + states.tuned.attemptedProposals, usd: 0, searches: 0, searchUsd: 0 },
        optimizer: {
          caseId: item.id, scope: "one-final-demand-day", aggregateScope: "four-final-demand-days", tunedVsBasePercent: entry.comparison.tunedVsBasePercent, aggregate: entry,
          legacyScoreScope: "Legacy train/select slots both contain the retained layout's measured feedback score. final and catalog metrics contain four-day held-out results. usage.usd is zero because this offline replay makes no paid calls; it is not the pilot training cost.",
          initial: replaySide("Initial factory", item.initial, initialResult, states.base.initialFinal!, states.base.initialFinal!),
        },
      };
      replays.set(`${item.id}-${day.profile}.json`, replay);
    }
  }
  if (graderHash() !== options.graderHash) throw new Error("Grader changed during replay export");
  return { catalog, replays };
}

export function exportOptimizerReplays(options: { evaluationDirectory?: string; dataDirectory?: string; outputDirectory?: string } = {}) {
  const evaluation = resolve(options.evaluationDirectory ?? "runs/optimizer-eval/test-v1");
  const data = resolve(options.dataDirectory ?? "runs/optimizer-data/v1");
  const output = resolve(options.outputDirectory ?? "runs/optimizer-viewer/data");
  if (!output.startsWith(resolve("runs/optimizer-viewer") + "/") || existsSync(output)) throw new Error("Output must be a new directory inside runs/optimizer-viewer/");
  const metricsPath = join(evaluation, "metrics.json"), planPath = join(evaluation, "evaluation-plan.json"), casesPath = join(data, "test-factories.jsonl");
  const metricsText = readFileSync(metricsPath, "utf8"), planText = readFileSync(planPath, "utf8"), casesText = readFileSync(casesPath, "utf8");
  const report = JSON.parse(metricsText) as OptimizerSavedReport;
  const plan = JSON.parse(planText);
  if (contentHash(plan) !== report.planHash || contentHash(casesText) !== plan.datasetHash) throw new Error("Evaluation provenance hashes do not match");
  const cases = casesText.trim().split("\n").map(line => JSON.parse(line) as OptimizerCase);
  if (cases.length !== 20) throw new Error("The optimizer viewer must contain all 20 evaluated factories");
  const evidence = ["docs/evidence/optimizer-pilot-audit.json", "docs/evidence/optimizer-pilot-results.json", "docs/evidence/nemotron-optimizer-pilot.md"].filter(path => existsSync(path));
  const sourceHashes = { metrics: contentHash(metricsText), evaluationPlan: contentHash(planText), testFactories: contentHash(casesText), ...Object.fromEntries(evidence.map(path => [path, contentHash(readFileSync(path, "utf8"))])) };
  const result = buildOptimizerReplays(report, cases, { createdAt: new Date().toISOString(), graderHash: plan.graderHash, sourceHashes, evidenceFiles: evidence.map(path => path.split("/").at(-1)!) });
  mkdirSync(output, { recursive: true });
  for (const [name, replay] of result.replays) writeFileSync(join(output, name), JSON.stringify(replay) + "\n", { flag: "wx" });
  for (const path of evidence) writeFileSync(join(output, path.split("/").at(-1)!), readFileSync(path), { flag: "wx" });
  writeFileSync(join(output, "catalog.json"), JSON.stringify(result.catalog, null, 2) + "\n", { flag: "wx" });
  return { output, factories: result.catalog.cases.length, replays: result.replays.size, defaultCaseId: result.catalog.defaultCaseId, defaultProfile: result.catalog.defaultProfile, sourceHashes };
}
