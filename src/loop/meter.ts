/**
 * Counts every simulator call the loop makes, by purpose, without touching the frozen grader.
 * evaluations = evaluate() calls; scenarioSims = individual 100-package simulations inside them.
 */
import type { DefinitionOfDone } from "../sim/dod.ts";
import { simulate } from "../sim/engine.ts";
import { evaluate, type Evaluation } from "../sim/evaluate.ts";
import type { Split } from "../sim/scenarios.ts";
import type { Layout, RunResult, Scenario } from "../sim/types.ts";

export type SimPurpose = "baseline" | "candidate" | "gate" | "probe" | "hypothesis-test" | "attribution" | "replay";
type Counts = Record<SimPurpose, { evaluations: number; scenarioSims: number }>;
const zero = (): Counts => ({
  baseline: { evaluations: 0, scenarioSims: 0 }, candidate: { evaluations: 0, scenarioSims: 0 }, gate: { evaluations: 0, scenarioSims: 0 },
  probe: { evaluations: 0, scenarioSims: 0 }, "hypothesis-test": { evaluations: 0, scenarioSims: 0 },
  attribution: { evaluations: 0, scenarioSims: 0 }, replay: { evaluations: 0, scenarioSims: 0 },
});
let counts = zero();
let cap: number | null = null;
let used = 0;

export class SimCapError extends Error {}

/** Hard per-run simulator cap: the next evaluate()/simulate() call past the cap is refused. */
export function setSimCap(max: number | null) {
  cap = max;
  used = 0;
}
const charge = () => {
  if (cap !== null && used >= cap) throw new SimCapError(`run simulator cap reached (${used}/${cap})`);
  used++;
};

export function meteredEvaluate(purpose: SimPurpose, layout: Layout, split: Split, dod?: DefinitionOfDone): Evaluation {
  if (purpose !== "replay" && purpose !== "baseline") charge();
  const e = evaluate(layout, split, dod);
  counts[purpose].evaluations++;
  counts[purpose].scenarioSims += e.results.length;
  return e;
}

export function meteredSimulate(purpose: SimPurpose, layout: Layout, scenario: Scenario): RunResult {
  counts[purpose].scenarioSims++;
  return simulate(layout, scenario);
}

/** Evaluations charged against the current run's simulator cap (excludes baseline and replay rendering). */
export const simUsed = () => used;

export function meterSnapshot(): Counts {
  return JSON.parse(JSON.stringify(counts));
}

/** Per-run delta, plus totals. */
export function meterDelta(before: Counts) {
  const now = meterSnapshot();
  const out = zero();
  let evaluations = 0, scenarioSims = 0;
  for (const k of Object.keys(out) as SimPurpose[]) {
    out[k].evaluations = now[k].evaluations - before[k].evaluations;
    out[k].scenarioSims = now[k].scenarioSims - before[k].scenarioSims;
    evaluations += out[k].evaluations;
    scenarioSims += out[k].scenarioSims;
  }
  return { byPurpose: out, evaluations, scenarioSims };
}
