import type { RunMetrics, RunResult } from "./types.ts";

export type NumericMetric = {
  [K in keyof RunMetrics]: RunMetrics[K] extends number ? K : never;
}[keyof RunMetrics];

export interface DoDCheck {
  id: string;
  description: string;
  metric: NumericMetric;
  op: "<=" | ">=" | "==";
  value: number;
  /** every: each scenario must pass. mean: the average across scenarios must pass. */
  scope: "every" | "mean";
}

/** Executable definition of done. The Goal Planner writes this; code evaluates it. */
export interface DefinitionOfDone {
  goal: string;
  checks: DoDCheck[];
}

export interface DoDCheckResult extends DoDCheck {
  passed: boolean;
  actual: number;
  /** Scenario ids that failed an "every" check. */
  failing: string[];
}

export interface DoDResult {
  passed: boolean;
  checks: DoDCheckResult[];
}

/**
 * Non-negotiable checks the DoD Auditor enforces no matter what the planner
 * writes, so a team can't declare victory by quietly lowering the bar.
 */
export const FLOOR_CHECKS: DoDCheck[] = [
  { id: "all-shipped", description: "Every package ships", metric: "unshipped", op: "==", value: 0, scope: "every" },
];

const NUMERIC_METRICS: NumericMetric[] = [
  "packages", "shipped", "unshipped", "missorts", "damaged", "makespan", "drainTime",
  "throughputPerHour", "avgCycleTime", "avgWait", "maxQueue", "travelCells", "capex", "objective",
];

export function isNumericMetric(m: string): m is NumericMetric {
  return (NUMERIC_METRICS as string[]).includes(m);
}

function compare(actual: number, op: DoDCheck["op"], value: number) {
  return op === "<=" ? actual <= value : op === ">=" ? actual >= value : actual === value;
}

export function evaluateDoD(dod: DefinitionOfDone, results: RunResult[]): DoDResult {
  const checks = [...FLOOR_CHECKS, ...dod.checks.filter((c) => !FLOOR_CHECKS.some((f) => f.id === c.id))].map(
    (c): DoDCheckResult => {
      const values = results.map((r) => r.metrics[c.metric]);
      if (c.scope === "mean") {
        const actual = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
        return { ...c, actual: Math.round(actual * 100) / 100, passed: compare(actual, c.op, c.value), failing: [] };
      }
      const failing = results.filter((r) => !compare(r.metrics[c.metric], c.op, c.value)).map((r) => r.scenario.id);
      // For "every", report the worst value so the UI shows how far off it is.
      const worst = c.op === ">=" ? Math.min(...values) : Math.max(...values);
      return { ...c, actual: worst, passed: failing.length === 0, failing };
    },
  );
  return { passed: checks.every((c) => c.passed), checks };
}

/** Hand-written DoD used until the Goal Planner agent writes one. */
export const DEFAULT_DOD: DefinitionOfDone = {
  goal: "Ship all 100 packages within 25 minutes with at most 1 mis-sort and nothing damaged.",
  checks: [
    { id: "makespan", description: "Floor clears within 25 minutes", metric: "makespan", op: "<=", value: 1500, scope: "every" },
    { id: "missorts", description: "At most 1 mis-sort per run", metric: "missorts", op: "<=", value: 1, scope: "every" },
    { id: "damaged", description: "No damaged packages", metric: "damaged", op: "==", value: 0, scope: "every" },
  ],
};
