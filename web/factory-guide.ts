import { SIM } from '../src/sim/config';
import { simulate } from '../src/sim/engine';
import { makeScenario } from '../src/sim/scenarios';
import type { Station, PackageTrace } from '../src/sim/types';
import type { ReplayBundle } from './contracts';

export const DEMAND_PROFILES = [
  { id: 'normal', name: 'Normal', seed: 201, window: '20 min', fragile: '10%', description: 'Steady arrivals across a 20-minute shift.' },
  { id: 'peak', name: 'Peak', seed: 202, window: '5 min', fragile: '10%', description: 'The same volume arrives in five minutes, stressing queues.' },
  { id: 'fragile', name: 'Fragile', seed: 203, window: '20 min', fragile: '35%', description: 'Steady arrivals with more fragile packages, stressing long routes.' },
] as const;
export type DemandProfile = typeof DEMAND_PROFILES[number]['id'];

// Preview the saved layouts with the real simulator without changing run evidence.
export function previewDemand(bundle: ReplayBundle, profile: DemandProfile): ReplayBundle {
  const option = DEMAND_PROFILES.find(p => p.id === profile)!;
  const scenario = makeScenario(option.seed, profile, bundle.baseline.result.trace.length);
  return { ...bundle, scenario: { id: scenario.id, seed: scenario.seed, profile },
    baseline: { ...bundle.baseline, result: simulate(bundle.baseline.layout, scenario) },
    improved: { ...bundle.improved, result: simulate(bundle.improved.layout, scenario) } };
}

export function stationRole(station: Station) {
  switch (station.kind) {
    case 'receiving': return { name: 'Receiving', action: 'Receive', time: `${SIM.service.receiving} s / package`, description: 'Accepts incoming packages and sends them to a sorter. One package at a time; waiting packages queue in arrival order.' };
    case 'sorter': return { name: 'Sorting', action: 'Sort', time: `${SIM.service.sorter} s / package`, description: 'Chooses a packing station that supports both the package size and destination. If none qualifies, it uses a fallback station and records a mis-sort.' };
    case 'pack': return { name: 'Packing', action: 'Pack', time: `S ${SIM.service.pack.S}s · M ${SIM.service.pack.M}s · L ${SIM.service.pack.L}s`, description: 'Packs one box at a time, then sends it to a shipping dock serving its destination. Size and destination settings determine whether this station qualifies at sorting.' };
    case 'shipping': return { name: 'Shipping', action: 'Ship', time: `${SIM.service.shipping} s / package`, description: `Dispatches packages for destination ${(station.zones ?? []).join(', ')}. A package with no matching shipping dock remains unshipped.` };
  }
}

export function stationFailures(station: Station, traces: PackageTrace[]) {
  const handled = traces.filter(t => t.steps.some(s => s.station === station.id));
  const arrivedDamaged = handled.filter(t => {
    const entry = t.steps.find(s => s.station === station.id)!.enter;
    return t.fragile && t.legs.some(l => l.t1 <= entry && l.cells > SIM.fragileMaxLeg);
  }).length;
  const fallback = handled.filter(t => t.missorted).length;
  const inbound = new Map<string, { from: string; cells: number; packages: number; damagedHere: number }>();
  for (const t of handled) for (const l of t.legs.filter(l => l.to === station.id)) {
    const key = `${l.from}:${l.cells}`;
    const route = inbound.get(key) ?? { from: l.from, cells: l.cells, packages: 0, damagedHere: 0 };
    route.packages++;
    if (t.fragile && l.cells > SIM.fragileMaxLeg && !t.legs.some(prior => prior.t1 <= l.t0 && prior.cells > SIM.fragileMaxLeg)) route.damagedHere++;
    inbound.set(key, route);
  }
  return { arrivedDamaged, fallback, inbound: [...inbound.values()] };
}

export const ROUTING_RULE = 'Among eligible stations: shortest queue (including the busy slot), then shortest grid distance, then station ID.';
export const DAMAGE_RULE = `A fragile package is damaged if any single trip exceeds ${SIM.fragileMaxLeg} grid cells. Exactly ${SIM.fragileMaxLeg} is safe. Travel takes ${SIM.secondsPerCell} seconds per cell.`;
export const MISSORT_RULE = 'A mis-sort means no packing station supports both size and destination. The sorter uses a fallback; the package may still ship.';
