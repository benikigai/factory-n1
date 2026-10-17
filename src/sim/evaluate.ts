import { evaluateDoD, type DefinitionOfDone, type DoDResult } from "./dod.ts";
import { simulate } from "./engine.ts";
import { validateLayout } from "./layout.ts";
import { scenariosFor, type Split } from "./scenarios.ts";
import type { Layout, RunResult } from "./types.ts";

export interface Evaluation {
  layout: string;
  split: Split;
  valid: boolean;
  errors: string[];
  /** Mean objective across the split's scenarios. Infinity if the layout is invalid. */
  objective: number;
  results: RunResult[];
  dod: DoDResult | null;
}

export function evaluate(layout: Layout, split: Split, dod?: DefinitionOfDone): Evaluation {
  const errors = validateLayout(layout);
  if (errors.length) {
    return { layout: layout.name, split, valid: false, errors, objective: Infinity, results: [], dod: null };
  }
  const results = scenariosFor(split).map((s) => simulate(layout, s));
  const objective = results.reduce((a, r) => a + r.metrics.objective, 0) / results.length;
  return {
    layout: layout.name,
    split,
    valid: true,
    errors: [],
    objective: Math.round(objective * 100) / 100,
    results,
    dod: dod ? evaluateDoD(dod, results) : null,
  };
}

/** Compact per-scenario summary for prompts and logs (no traces). */
export function summarize(e: Evaluation) {
  return {
    layout: e.layout,
    split: e.split,
    valid: e.valid,
    errors: e.errors,
    objective: e.objective,
    dodPassed: e.dod?.passed ?? null,
    failedChecks: e.dod?.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.metric} ${c.op} ${c.value}, got ${c.actual}`) ?? [],
    scenarios: e.results.map((r) => {
      const { stations, ...m } = r.metrics;
      return { id: r.scenario.id, ...m };
    }),
  };
}
