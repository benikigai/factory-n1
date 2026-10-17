/**
 * Blind search baseline: random edits to the stations the task allows, keeping any
 * train improvement. Run with the same number of simulator evaluations the agent team
 * used, so the comparison is at equal budget.
 */
import { evaluate } from "../sim/evaluate.ts";
import { rng } from "../sim/scenarios.ts";
import type { Layout, Size, Zone } from "../sim/types.ts";
import { validateForTask, type Task } from "../tasks/task.ts";

export function hillclimb(task: Task, evals: number, seed = 1): { layout: Layout; train: number; select: number; evalsUsed: number } {
  const r = rng(seed);
  const ri = (n: number) => Math.floor(r() * n);
  const subset = <T,>(all: T[]): T[] => {
    const s = all.filter(() => r() < 0.5);
    return s.length ? s : [all[ri(all.length)]];
  };
  const { w, h } = task.initial.grid;
  let id = 0;
  const mutate = (l: Layout): Layout => {
    const m: Layout = JSON.parse(JSON.stringify(l));
    const editable = m.stations.filter((s) => !task.fixed.includes(s.id));
    const s = editable[ri(editable.length)];
    const k = ri(5);
    if (k <= 1 && s) {
      s.x = Math.max(0, Math.min(w - 1, s.x + ri(7) - 3));
      s.y = Math.max(0, Math.min(h - 1, s.y + ri(7) - 3));
    } else if (k === 2 && s?.kind === "pack") s.zones = subset<Zone>(["A", "B", "C"]);
    else if (k === 3 && s?.kind === "pack") s.sizes = subset<Size>(["S", "M", "L"]);
    else if (k === 4) {
      if (r() < 0.5) m.stations.push({ id: `pack-h${id++}`, kind: "pack", x: ri(w), y: ri(h), zones: subset<Zone>(["A", "B", "C"]), sizes: subset<Size>(["S", "M", "L"]) });
      else if (s) m.stations = m.stations.filter((x) => x.id !== s.id);
    }
    return m;
  };
  let cur = task.initial;
  let curObj = evaluate(cur, "train").objective;
  let used = 0;
  let tries = 0;
  while (used < evals && tries++ < evals * 500) {
    const c = mutate(cur);
    if (validateForTask(c, task).length) continue; // invalid edits are free: agents' invalid proposals aren't simulated either
    used++;
    const o = evaluate(c, "train").objective;
    if (o <= curObj) {
      cur = c;
      curObj = o;
    }
  }
  return { layout: cur, train: curObj, select: evaluate(cur, "select").objective, evalsUsed: used };
}
