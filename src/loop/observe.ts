/**
 * What the team is allowed to see about a layout's run: per-day results, per-station
 * load, and sensor-style route observations. The simulator's internal rules (damage
 * threshold, mis-sort rule, service times) are never stated.
 */
import type { Evaluation } from "../sim/evaluate.ts";

export function observe(train: Evaluation): string {
  if (!train.valid) return `INVALID LAYOUT: ${train.errors.join("; ")}`;
  const n = train.results.length;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const stations = Object.entries(train.results[0].metrics.stations)
    .map(([id, s]) => {
      const waits = train.results.map((r) => r.metrics.stations[id]?.totalWait ?? 0);
      const util = train.results.map((r) => r.metrics.stations[id]?.utilization ?? 0);
      return `${id} (${s.kind}): avg total wait ${Math.round(mean(waits))}s, avg utilization ${mean(util).toFixed(2)}`;
    })
    .join("\n");
  const days = train.results
    .map((r) => `${r.scenario.id}: makespan ${r.metrics.makespan}s, mis-sorts ${r.metrics.missorts}, damaged ${r.metrics.damaged}, objective ${r.metrics.objective}`)
    .join("\n");
  const routes = new Map<string, { cells: number; fragile: number; damaged: number; packages: number }>();
  for (const r of train.results) {
    for (const t of r.trace) {
      for (const leg of t.legs) {
        const k = `${leg.from}->${leg.to}`;
        const e = routes.get(k) ?? { cells: leg.cells, fragile: 0, damaged: 0, packages: 0 };
        e.packages++;
        if (t.fragile) e.fragile++;
        if (t.damaged) e.damaged++;
        routes.set(k, e);
      }
    }
  }
  const routeLines = [...routes.entries()]
    .sort((a, b) => b[1].damaged - a[1].damaged || b[1].cells - a[1].cells)
    .slice(0, 8)
    .map(([k, e]) => `${k}: ${e.cells} cells long, ${e.packages} trips, ${e.fragile} fragile, ${e.damaged} of the packages on this route arrived damaged`)
    .join("\n");
  const failing = train.dod?.checks.filter((c) => !c.passed).map((c) => `${c.description} (got ${c.actual})`).join("; ") || "none";
  return `RESULTS ON THE ${n} TRAINING DAYS (average objective ${train.objective}):\n${days}\n\nPER-STATION LOAD:\n${stations}\n\nCONVEYOR ROUTES (all training days):\n${routeLines}\n\nFAILING GOAL CHECKS: ${failing}`;
}
