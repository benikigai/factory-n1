import { OBJECTIVE, SIM } from "../sim/config.ts";
import { DEFAULT_DOD, evaluateDoD } from "../sim/dod.ts";
import { simulate } from "../sim/engine.ts";
import { makeScenario, SPLITS } from "../sim/scenarios.ts";
import type { Layout, Profile, RunMetrics, Station } from "../sim/types.ts";
import { SIM_VERSION } from "../sim/version.ts";
import { validateForTask, type Task } from "../tasks/task.ts";

export interface DemandDay { seed: number; profile: Profile; count: number }

export interface CriticInput {
  version: "factory-layout-critic-v1";
  goal: string;
  simulator: { version: string; parameters: typeof SIM; objective: typeof OBJECTIVE };
  constraints: { fixedStations: Station[]; sorter: [number, number]; pack: [number, number]; capexCap: number };
  demand: DemandDay[];
  layout: Layout;
}

export interface CriticOutput {
  valid: boolean;
  errors: string[];
  metrics: { objective: number; makespan: number; damaged: number; missorts: number; unshipped: number } | null;
  zeroDamage: boolean | null;
  allShipped: boolean | null;
  goalMet: boolean | null;
}

export const CRITIC_SYSTEM = "You are a factory layout critic. Given a layout, fixed building constraints, simulator parameters, demand-day seeds and profiles, predict the simulator outcome. Return only JSON with keys valid, errors, metrics, zeroDamage, allShipped, goalMet. Invalid layouts have error strings and null metrics and outcome flags. For valid layouts errors is empty; metrics contains objective, makespan, damaged, missorts, unshipped, averaged over the listed demand days and rounded to 2 decimals. zeroDamage and allShipped must hold on every day. goalMet means every day ships all packages within 1500 seconds with at most 1 missort and zero damage. No explanation or reasoning text.";

export function criticInput(task: Task, layout: Layout, demand: DemandDay[]): CriticInput {
  return {
    version: "factory-layout-critic-v1", goal: task.goal,
    simulator: { version: SIM_VERSION, parameters: SIM, objective: OBJECTIVE },
    constraints: {
      fixedStations: task.initial.stations.filter(s => task.fixed.includes(s.id)),
      sorter: task.editable.sorter, pack: task.editable.pack, capexCap: task.capexCap,
    },
    demand, layout: { ...layout, name: "candidate" },
  };
}

/** The same single-turn input builder can be used for hosted inference after training. */
export function criticMessages(input: CriticInput) {
  return [{ role: "system" as const, content: CRITIC_SYSTEM }, { role: "user" as const, content: JSON.stringify(input) }];
}

export function labelLayout(task: Task, layout: Layout, demand: DemandDay[]) {
  const reserved = new Set(Object.values(SPLITS).flat().map(day => day.seed));
  if (!demand.length || demand.some(day => !Number.isSafeInteger(day.seed) || reserved.has(day.seed) || day.count !== 100)) {
    throw new Error("Use non-reserved integer demand seeds and 100 packages per day");
  }
  const errors = validateForTask(layout, task);
  if (errors.length) {
    const output: CriticOutput = { valid: false, errors, metrics: null, zeroDamage: null, allShipped: null, goalMet: null };
    return { output, days: [] as { seed: number; profile: Profile; metrics: RunMetrics }[] };
  }
  // Call the unchanged engine directly with fresh demand, never the reserved split evaluator.
  const results = demand.map(day => simulate(layout, makeScenario(day.seed, day.profile, day.count)));
  const mean = (key: keyof NonNullable<CriticOutput["metrics"]>) => Math.round(results.reduce((sum, result) => sum + result.metrics[key], 0) / results.length * 100) / 100;
  const output: CriticOutput = {
    valid: true, errors: [],
    metrics: { objective: mean("objective"), makespan: mean("makespan"), damaged: mean("damaged"), missorts: mean("missorts"), unshipped: mean("unshipped") },
    zeroDamage: results.every(result => result.metrics.damaged === 0),
    allShipped: results.every(result => result.metrics.unshipped === 0),
    goalMet: evaluateDoD(DEFAULT_DOD, results).passed,
  };
  return { output, days: results.map(result => ({ ...result.scenario, metrics: result.metrics })) };
}
