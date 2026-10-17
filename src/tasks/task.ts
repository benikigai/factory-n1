import { readFileSync } from "node:fs";
import { SIM } from "../sim/config.ts";
import { schemaErrors, validateLayout } from "../sim/layout.ts";
import type { Layout, Station } from "../sim/types.ts";

/**
 * A factory the team must improve. Docks and grid are physical givens; the team may only
 * place 1-2 sorters and 2-6 pack stations and choose what each pack station accepts.
 */
export interface Task {
  id: string;
  goal: string;
  initial: Layout;
  /** Station ids the team may not move, edit, or remove. */
  fixed: string[];
  editable: { sorter: [number, number]; pack: [number, number] };
  capexCap: number;
}

const GOAL = "Ship all 100 packages within 25 minutes with at most 1 mis-sort and nothing damaged.";

/** Factory geometries. A/B are for learning, C gates solver-policy changes, D/E are held out for the final test. */
export const FACTORIES = {
  "factory-a": "baseline.json",
  "factory-b": "factory-b-crossdock.json",
  "factory-c": "factory-c-uflow.json",
  "factory-d": "factory-d-lflow.json",
  "factory-e": "factory-e-twoinbound.json",
} as const;
export type FactoryId = keyof typeof FACTORIES;

export function loadTask(id: FactoryId): Task {
  const initial = JSON.parse(readFileSync(new URL(`../../layouts/${FACTORIES[id]}`, import.meta.url), "utf8")) as Layout;
  return {
    id,
    goal: GOAL,
    initial,
    fixed: initial.stations.filter((s) => s.kind === "receiving" || s.kind === "shipping").map((s) => s.id),
    editable: { sorter: [1, 2], pack: [2, 6] },
    capexCap: 300_000,
  };
}

export const loadTaskA = () => loadTask("factory-a");

const same = (a: Station, b: Station) =>
  a.kind === b.kind && a.x === b.x && a.y === b.y && JSON.stringify(a.zones ?? []) === JSON.stringify(b.zones ?? []);

/** Physical constraints plus task rules. Errors are returned to the designer verbatim. */
export function validateForTask(layout: Layout, task: Task): string[] {
  const shape = schemaErrors(layout);
  if (shape.length) return shape;
  const errors = validateLayout(layout);
  if (layout.grid?.w !== task.initial.grid.w || layout.grid?.h !== task.initial.grid.h) {
    errors.push(`grid is fixed at ${task.initial.grid.w}x${task.initial.grid.h}`);
  }
  const byId = new Map(layout.stations.map((s) => [s.id, s]));
  for (const id of task.fixed) {
    const orig = task.initial.stations.find((s) => s.id === id)!;
    const now = byId.get(id);
    if (!now) errors.push(`${id} is a fixed dock and cannot be removed`);
    else if (!same(orig, now)) errors.push(`${id} is a fixed dock and cannot be moved or changed`);
  }
  for (const s of layout.stations) {
    if ((s.kind === "receiving" || s.kind === "shipping") && !task.fixed.includes(s.id)) {
      errors.push(`${s.id}: docks are fixed by the building; you cannot add ${s.kind} stations`);
    }
  }
  for (const kind of ["sorter", "pack"] as const) {
    const n = layout.stations.filter((s) => s.kind === kind).length;
    const [lo, hi] = task.editable[kind];
    if (n < lo || n > hi) errors.push(`this task allows ${lo}-${hi} ${kind} stations, found ${n}`);
  }
  const capex = layout.stations.reduce((sum, s) => sum + SIM.capex[s.kind], 0);
  if (capex > task.capexCap) errors.push(`capex $${capex} exceeds the $${task.capexCap} cap`);
  return [...new Set(errors)];
}
