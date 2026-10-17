// Seeded generator for fresh evaluation factories. Run once, before any evaluation, and commit the
// output. A layout is accepted only if it is valid, its Gen-0 fails the goal, and the goal is reachable
// (checked offline by the 3,000-eval hill-climber; that solution is never shown to agents).
import { writeFileSync } from "node:fs";
import { hillclimb } from "../src/baselines/hillclimb.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { rng } from "../src/sim/scenarios.ts";
import type { Layout, Station } from "../src/sim/types.ts";
import type { Task } from "../src/tasks/task.ts";
import { validateForTask } from "../src/tasks/task.ts";

const W = 24, H = 14;
function generate(seed: number, name: string): Layout {
  const r = rng(seed);
  const ri = (n: number) => Math.floor(r() * n);
  const wall = (side: number) => (side === 0 ? { x: 0, y: 1 + ri(H - 2) } : side === 1 ? { x: W - 1, y: 1 + ri(H - 2) } : side === 2 ? { x: 1 + ri(W - 2), y: 0 } : { x: 1 + ri(W - 2), y: H - 1 });
  const stations: Station[] = [];
  const far = (p: { x: number; y: number }) => stations.every((s) => Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)) >= 3);
  const place = (st: Omit<Station, "x" | "y">, pick: () => { x: number; y: number }) => {
    for (let i = 0; i < 500; i++) { const p = pick(); if (far(p)) { stations.push({ ...st, ...p } as Station); return; } }
    throw new Error("could not place");
  };
  const inSide = ri(4);
  place({ id: "recv-1", kind: "receiving" }, () => wall(inSide));
  for (const z of ["A", "B", "C"] as const) place({ id: `ship-${z}`, kind: "shipping", zones: [z] }, () => wall(ri(4)));
  // Deliberately weak interior, like factory A: one sorter, two pack stations without size L.
  place({ id: "sort-1", kind: "sorter" }, () => ({ x: 2 + ri(W - 4), y: 2 + ri(H - 4) }));
  for (const id of ["pack-1", "pack-2"]) place({ id, kind: "pack", zones: ["A", "B", "C"], sizes: ["S", "M"] }, () => ({ x: 2 + ri(W - 4), y: 2 + ri(H - 4) }));
  return { name, grid: { w: W, h: H }, stations };
}

const asTask = (id: string, initial: Layout): Task => ({
  id, goal: "Ship all 100 packages within 25 minutes with at most 1 mis-sort and nothing damaged.", initial,
  fixed: initial.stations.filter((s) => s.kind === "receiving" || s.kind === "shipping").map((s) => s.id),
  editable: { sorter: [1, 2], pack: [2, 6] }, capexCap: 300_000,
});

const wanted = [{ file: "factory-f-generated.json", id: "factory-f" }, { file: "factory-g-generated.json", id: "factory-g" }];
let seed = 7001;
for (const w of wanted) {
  for (;; seed++) {
    let layout: Layout;
    try { layout = generate(seed, `${w.id}-seed${seed}`); } catch { continue; }
    const task = asTask(w.id, layout);
    if (validateForTask(layout, task).length) continue;
    if (evaluate(layout, "train", DEFAULT_DOD).dod!.passed) continue;
    const reachable = [1, 2, 3].some((s) => evaluate(hillclimb(task, 3000, s).layout, "select", DEFAULT_DOD).dod!.passed);
    console.log(`${w.id}: seed ${seed} ${reachable ? "accepted" : "rejected (goal not reachable)"}`);
    if (!reachable) continue;
    writeFileSync(`layouts/${w.file}`, JSON.stringify(layout) + "\n");
    seed++;
    break;
  }
}
