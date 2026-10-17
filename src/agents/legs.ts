/**
 * Deterministic ruler for designers: every conveyor leg a layout can route a package over, with its
 * length in cells (|dx| + |dy|, the distance the simulator moves packages). It measures geometry only:
 * it never runs the simulator, never scores, and knows nothing about grader thresholds.
 */
import { distance } from "../sim/layout.ts";
import type { Layout, Station } from "../sim/types.ts";

export interface Leg {
  from: string;
  to: string;
  cells: number;
}

/** All legs routing can use: receiving->sorter, sorter->pack, pack->a dock serving one of its zones. Longest first. */
export function possibleLegs(layout: Layout): Leg[] {
  const of = (k: Station["kind"]) => layout.stations.filter((s) => s.kind === k);
  const legs: Leg[] = [];
  const add = (a: Station, b: Station) => legs.push({ from: a.id, to: b.id, cells: distance(a, b) });
  for (const r of of("receiving")) for (const s of of("sorter")) add(r, s);
  for (const s of of("sorter")) for (const p of of("pack")) add(s, p);
  for (const p of of("pack")) for (const d of of("shipping")) if (d.zones?.some((z) => p.zones?.includes(z))) add(p, d);
  return legs.sort((a, b) => b.cells - a.cells || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** The layout with one station moved to (x, y); everything else unchanged. */
export function moved(layout: Layout, stationId: string, x: number, y: number): Layout {
  return { ...layout, stations: layout.stations.map((s) => (s.id === stationId ? { ...s, x, y } : s)) };
}

/** That station's own legs (in and out) at each candidate cell. */
export function legsAt(layout: Layout, stationId: string, cells: { x: number; y: number }[]) {
  return cells.map(({ x, y }) => {
    const legs = possibleLegs(moved(layout, stationId, x, y)).filter((l) => l.from === stationId || l.to === stationId);
    return { x, y, legs, longest: Math.max(0, ...legs.map((l) => l.cells)) };
  });
}
