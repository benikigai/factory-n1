/**
 * Causal receipts: split a layout change into atomic edits and score each edit alone
 * against the previous champion. Models narrate causes wrongly (Super VL credited a
 * sorter move for a mis-sort fix); lessons and the UI may only cite these numbers.
 */
import { evaluate } from "../sim/evaluate.ts";
import type { Layout, Station } from "../sim/types.ts";

export interface AtomicEdit {
  edit: string;
  apply(layout: Layout): Layout;
}

const key = (xs?: string[]) => [...(xs ?? [])].sort().join(",");

export function diffLayouts(before: Layout, after: Layout): AtomicEdit[] {
  const edits: AtomicEdit[] = [];
  const b = new Map(before.stations.map((s) => [s.id, s]));
  const a = new Map(after.stations.map((s) => [s.id, s]));
  const replace = (id: string, patch: Partial<Station>) => (l: Layout): Layout => ({
    ...l,
    stations: l.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  });
  for (const [id, s] of b) {
    const n = a.get(id);
    if (!n) {
      edits.push({ edit: `remove ${id}`, apply: (l) => ({ ...l, stations: l.stations.filter((x) => x.id !== id) }) });
      continue;
    }
    if (s.x !== n.x || s.y !== n.y) edits.push({ edit: `${id} (${s.x},${s.y}) -> (${n.x},${n.y})`, apply: replace(id, { x: n.x, y: n.y }) });
    if (key(s.zones) !== key(n.zones)) edits.push({ edit: `${id} zones ${key(s.zones)} -> ${key(n.zones)}`, apply: replace(id, { zones: n.zones }) });
    if (key(s.sizes) !== key(n.sizes)) edits.push({ edit: `${id} sizes ${key(s.sizes)} -> ${key(n.sizes)}`, apply: replace(id, { sizes: n.sizes }) });
  }
  for (const [id, n] of a) {
    if (!b.has(id)) edits.push({ edit: `add ${n.kind} ${id} at (${n.x},${n.y})`, apply: (l) => ({ ...l, stations: [...l.stations, n] }) });
  }
  return edits;
}

/** Train-objective change of each edit applied alone to `before`. null = that edit alone is not a valid layout. */
export function attribute(before: Layout, after: Layout): { edit: string; deltaAlone: number | null }[] {
  const base = evaluate(before, "train").objective;
  return diffLayouts(before, after).map((e) => {
    const ev = evaluate(e.apply(before), "train");
    return { edit: e.edit, deltaAlone: ev.valid ? Math.round((ev.objective - base) * 100) / 100 : null };
  });
}
