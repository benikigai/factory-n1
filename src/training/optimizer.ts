import { OBJECTIVE, SIM } from "../sim/config.ts";
import { DEFAULT_DOD, evaluateDoD, type DoDCheckResult } from "../sim/dod.ts";
import { simulate } from "../sim/engine.ts";
import { makeScenario, SPLITS } from "../sim/scenarios.ts";
import type { Layout, RunMetrics } from "../sim/types.ts";
import { SIM_VERSION } from "../sim/version.ts";
import { validateForTask, type Task } from "../tasks/task.ts";
import type { DemandDay } from "./critic.ts";

export type OptimizerAction = { op: "move"; stationId: string; x: number; y: number } | { op: "stop" };
export interface OptimizerMeasurement {
  valid: boolean;
  errors: string[];
  objective: number | null;
  goalMet: boolean;
  checks: DoDCheckResult[];
  metrics: Pick<RunMetrics, "objective" | "makespan" | "damaged" | "missorts" | "unshipped" | "avgWait" | "travelCells"> | null;
  bottlenecks: { stationId: string; maxQueue: number; totalWait: number; utilization: number }[];
  days: { seed: number; profile: DemandDay["profile"]; metrics: RunMetrics }[];
}
export interface OptimizerAttempt {
  action?: OptimizerAction;
  rawText?: string;
  status: "invalid" | "rejected" | "accepted" | "stopped";
  reason?: string;
  feedback?: OptimizerMeasurement;
}

export const OPTIMIZER_PROMPT_PROFILE = "factory-single-move-optimizer-v1";
export const OPTIMIZER_SYSTEM = "You optimize a simulated factory by proposing one station move. Return only a JSON object: {\"op\":\"move\",\"stationId\":\"existing editable station id\",\"x\":integer,\"y\":integer}, or {\"op\":\"stop\"}. Move only a sorter or pack station. Keep all other attributes unchanged. Respect grid bounds, fixed docks and minimum station spacing. Reduce the measured objective while preserving every already-passed definition-of-done check. Measurements describe the current layout, not your proposed move. Use previous attempt feedback to avoid repeating failed moves. Prefer changes that reduce damage and transport distance or relieve measured queues. Stop if you cannot identify a useful legal move. No extra keys, markdown, explanation or predicted scores.";

export function parseAction(text: string): OptimizerAction {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Action must be a bare JSON object"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Action must be an object");
  const action = value as Record<string, unknown>;
  if (action.op === "stop" && Object.keys(action).length === 1) return { op: "stop" };
  if (action.op !== "move" || Object.keys(action).sort().join(",") !== "op,stationId,x,y" || typeof action.stationId !== "string" || !action.stationId.trim() || !Number.isSafeInteger(action.x) || !Number.isSafeInteger(action.y)) {
    throw new Error("Action must contain exactly op, stationId, integer x and integer y, or only op=stop");
  }
  return action as unknown as OptimizerAction;
}

export function applyAction(task: Task, layout: Layout, action: OptimizerAction): Layout {
  action = parseAction(JSON.stringify(action));
  const beforeErrors = validateForTask(layout, task);
  if (beforeErrors.length) throw new Error(`Starting layout is invalid: ${beforeErrors.join("; ")}`);
  const next = structuredClone(layout);
  if (action.op === "stop") return next;
  const station = next.stations.find(item => item.id === action.stationId);
  if (!station) throw new Error(`Unknown station ${action.stationId}`);
  if (task.fixed.includes(station.id) || !["sorter", "pack"].includes(station.kind)) throw new Error(`${station.id} is fixed`);
  if (station.x === action.x && station.y === action.y) throw new Error("Move must change the station position");
  station.x = action.x; station.y = action.y;
  const errors = validateForTask(next, task);
  if (errors.length) throw new Error(`Illegal move: ${errors.join("; ")}`);
  return next;
}

export function measureLayout(task: Task, layout: Layout, days: DemandDay[]): OptimizerMeasurement {
  const reserved = new Set(Object.values(SPLITS).flat().map(day => day.seed));
  if (!days.length || new Set(days.map(day => day.seed)).size !== days.length || days.some(day => !Number.isSafeInteger(day.seed) || reserved.has(day.seed) || day.count !== 100 || !["normal", "peak", "fragile", "skewed"].includes(day.profile))) throw new Error("Use unique fresh demand seeds with 100 packages per day");
  const errors = validateForTask(layout, task);
  if (errors.length) return { valid: false, errors, objective: null, goalMet: false, checks: [], metrics: null, bottlenecks: [], days: [] };
  const results = days.map(day => simulate(layout, makeScenario(day.seed, day.profile, day.count)));
  const dod = evaluateDoD(DEFAULT_DOD, results);
  const metrics = Object.fromEntries((["objective", "makespan", "damaged", "missorts", "unshipped", "avgWait", "travelCells"] as const).map(key => [key, results.reduce((sum, result) => sum + result.metrics[key], 0) / results.length])) as NonNullable<OptimizerMeasurement["metrics"]>;
  const bottlenecks = layout.stations.filter(station => ["sorter", "pack"].includes(station.kind)).map(station => {
    const stats = results.map(result => result.metrics.stations[station.id]);
    return { stationId: station.id, maxQueue: Math.max(...stats.map(stat => stat.maxQueue)), totalWait: stats.reduce((sum, stat) => sum + stat.totalWait, 0) / stats.length, utilization: stats.reduce((sum, stat) => sum + stat.utilization, 0) / stats.length };
  }).sort((a, b) => b.totalWait - a.totalWait || a.stationId.localeCompare(b.stationId));
  return { valid: true, errors: [], objective: metrics.objective, goalMet: dod.passed, checks: dod.checks, metrics, bottlenecks, days: results.map(result => ({ seed: result.scenario.seed, profile: result.scenario.profile, metrics: result.metrics })) };
}

export function betterCandidate(before: OptimizerMeasurement, after: OptimizerMeasurement): boolean {
  if (!before.valid || !after.valid || before.objective === null || after.objective === null || after.objective >= before.objective - 1e-9 || before.days.length !== after.days.length) return false;
  if (before.checks.some(check => check.passed && !after.checks.find(next => next.id === check.id)?.passed)) return false;
  return before.days.every(day => {
    const next = after.days.find(item => item.seed === day.seed && item.profile === day.profile);
    if (!next) return false;
    return before.checks.every(check => {
      const passes = (metrics: RunMetrics) => check.op === "==" ? metrics[check.metric] === check.value : check.op === "<=" ? metrics[check.metric] <= check.value : metrics[check.metric] >= check.value;
      return !passes(day.metrics) || passes(next.metrics);
    });
  });
}

export function optimizerMessages(task: Task, layout: Layout, measurement: OptimizerMeasurement, previousAttempts: OptimizerAttempt[] = []) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const observation = (measured: OptimizerMeasurement) => ({
    valid: measured.valid, errors: measured.errors, goalMet: measured.goalMet,
    metrics: measured.metrics && Object.fromEntries(Object.entries(measured.metrics).map(([key, value]) => [key, round(value)])),
    checks: measured.checks.map(({ id, metric, op, value, scope, passed, actual }) => ({ id, metric, op, value, scope, passed, actual: round(actual) })),
    bottlenecks: measured.bottlenecks.map(stats => ({ ...stats, totalWait: round(stats.totalWait), utilization: round(stats.utilization) })),
    demandProfiles: measured.days.map(day => day.profile), packagesPerDay: 100,
  });
  const input = {
    version: OPTIMIZER_PROMPT_PROFILE, goal: task.goal,
    simulator: { version: SIM_VERSION, parameters: SIM, objective: OBJECTIVE },
    constraints: { fixedStations: task.initial.stations.filter(station => task.fixed.includes(station.id)), sorter: task.editable.sorter, pack: task.editable.pack, capexCap: task.capexCap },
    layout: { ...layout, name: "candidate" },
    observation: observation(measurement),
    previousAttempts: previousAttempts.slice(-3).map(attempt => ({ action: attempt.action, rawText: attempt.rawText?.slice(0, 512), status: attempt.status, reason: attempt.reason?.slice(0, 512), feedback: attempt.feedback && observation(attempt.feedback) })),
  };
  return [{ role: "system" as const, content: OPTIMIZER_SYSTEM }, { role: "user" as const, content: JSON.stringify(input) }];
}
