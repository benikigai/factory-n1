/**
 * Pure trace interpretation for the 3D viewer. Everything the scene shows about a
 * package is derived here from the scored run's PackageTrace, so the animation is
 * the simulator's output and nothing else. No three.js, no DOM: unit-tested in
 * test/web-state.test.ts.
 */
import { SIM } from "../../src/sim/config.ts";
import type { Layout, PackageTrace, Station } from "../../src/sim/types.ts";

export type PkgState = "not_arrived" | "queued" | "in_service" | "traveling" | "shipped" | "stranded";

export interface GridPos {
  /** Grid column (Station.x). */
  x: number;
  /** Grid row (Station.y); the scene maps it to world z. */
  z: number;
}

export interface PkgView {
  state: PkgState;
  /** Station the package is at (queued, in service, shipped, stranded) or heading to (traveling). */
  station?: string;
  position: GridPos;
  /** 0..1 through the current queue wait, service, or leg. */
  progress?: number;
  /** Index into trace.steps for queued / in_service / shipped / stranded. */
  step?: number;
  /** Index into trace.legs while traveling. */
  leg?: number;
}

const stationMaps = new WeakMap<Layout, Map<string, Station>>();

export function stationsById(layout: Layout): Map<string, Station> {
  let m = stationMaps.get(layout);
  if (!m) {
    m = new Map(layout.stations.map((s) => [s.id, s]));
    stationMaps.set(layout, m);
  }
  return m;
}

function posOf(layout: Layout, id: string): GridPos {
  const s = stationsById(layout).get(id);
  return s ? { x: s.x, z: s.y } : { x: 0, z: 0 };
}

const frac = (t: number, a: number, b: number) => (b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0);

/**
 * Position along the L-shaped Manhattan path from `from` to `to`: first along x,
 * then along y, at constant speed. `f` is the fraction of the leg's time elapsed.
 */
export function legPosition(from: GridPos, to: GridPos, f: number): GridPos {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const ax = Math.abs(dx);
  const total = ax + Math.abs(dz);
  if (total === 0) return { x: from.x, z: from.z };
  const d = Math.min(1, Math.max(0, f)) * total;
  if (d <= ax) return { x: from.x + Math.sign(dx) * d, z: from.z };
  return { x: to.x, z: from.z + Math.sign(dz) * (d - ax) };
}

/**
 * Where a package is at sim time t, by the trace alone.
 * Intervals are half-open: [enter,start) queued, [start,end) in service, [t0,t1) traveling.
 */
export function stateAt(trace: PackageTrace, layout: Layout, t: number): PkgView {
  const { steps, legs } = trace;
  if (t < trace.arrival || steps.length === 0) {
    const first = steps[0]?.station;
    return { state: "not_arrived", station: first, position: first ? posOf(layout, first) : { x: 0, z: 0 } };
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const position = posOf(layout, s.station);
    // A step that never started (or never finished) holds the package there forever.
    if (s.start < 0) return { state: "queued", station: s.station, position, step: i, progress: 0 };
    if (t < s.start) return { state: "queued", station: s.station, position, step: i, progress: frac(t, s.enter, s.start) };
    if (s.end < 0 || t < s.end) {
      return { state: "in_service", station: s.station, position, step: i, progress: s.end < 0 ? 0 : frac(t, s.start, s.end) };
    }
    const leg = legs[i];
    if (!leg) break;
    if (t < leg.t1) {
      const f = frac(t, leg.t0, leg.t1);
      return {
        state: "traveling",
        station: leg.to,
        position: legPosition(posOf(layout, leg.from), posOf(layout, leg.to), f),
        leg: i,
        progress: f,
      };
    }
  }
  const lastIdx = steps.length - 1;
  const last = steps[lastIdx];
  return {
    state: trace.shippedAt !== null ? "shipped" : "stranded",
    station: last.station,
    position: posOf(layout, last.station),
    step: lastIdx,
  };
}

/** Sim time the package became damaged: the end of the first leg too long for a fragile item. */
export function damagedAt(trace: PackageTrace): number | null {
  if (!trace.damaged) return null;
  const leg = trace.legs.find((l) => l.cells > SIM.fragileMaxLeg) ?? trace.legs[trace.legs.length - 1];
  return leg ? leg.t1 : trace.arrival;
}

/** Sim time the package was missorted: when the sorter released it to a pack station that cannot handle it. */
export function missortedAt(trace: PackageTrace, layout: Layout): number | null {
  if (!trace.missorted) return null;
  const byId = stationsById(layout);
  const step = trace.steps.find((s) => byId.get(s.station)?.kind === "sorter");
  return step && step.end >= 0 ? step.end : trace.arrival;
}

export interface Frame {
  t: number;
  views: PkgView[];
  /** Position in its station's queue (0 = next to be served), or -1 when not queued. */
  queueIndex: number[];
  /** Position among stranded packages at the same station, or -1. */
  strandIndex: number[];
  /** Queued (not in service) count per station id. */
  queueByStation: Map<string, number>;
  /** Trace index of the package in service per station id. */
  serviceByStation: Map<string, number>;
  shipped: number;
  queued: number;
  damaged: number;
  stranded: number;
}

export interface TraceMeta {
  damagedAt: (number | null)[];
  missortedAt: (number | null)[];
}

export function traceMeta(traces: PackageTrace[], layout: Layout): TraceMeta {
  return { damagedAt: traces.map(damagedAt), missortedAt: traces.map((p) => missortedAt(p, layout)) };
}

/** Whole-floor snapshot at time t: every package's state plus queue order (by enter time) per station. */
export function frameAt(traces: PackageTrace[], layout: Layout, t: number, meta?: TraceMeta): Frame {
  const views = traces.map((p) => stateAt(p, layout, t));
  const queueIndex = new Array<number>(traces.length).fill(-1);
  const strandIndex = new Array<number>(traces.length).fill(-1);
  const queues = new Map<string, number[]>();
  const strands = new Map<string, number[]>();
  const serviceByStation = new Map<string, number>();
  let shipped = 0;
  let queued = 0;
  let damaged = 0;
  let stranded = 0;
  views.forEach((v, i) => {
    if (v.state === "queued" && v.station) {
      queued++;
      const q = queues.get(v.station) ?? [];
      q.push(i);
      queues.set(v.station, q);
    } else if (v.state === "in_service" && v.station) {
      serviceByStation.set(v.station, i);
    } else if (v.state === "shipped") {
      shipped++;
    } else if (v.state === "stranded" && v.station) {
      stranded++;
      const q = strands.get(v.station) ?? [];
      q.push(i);
      strands.set(v.station, q);
    }
    const dAt = meta ? meta.damagedAt[i] : damagedAt(traces[i]);
    if (dAt !== null && t >= dAt) damaged++;
  });
  const queueByStation = new Map<string, number>();
  for (const [station, idx] of queues) {
    const key = (i: number) => traces[i].steps[views[i].step!];
    idx.sort((a, b) => key(a).enter - key(b).enter || key(a).start - key(b).start || traces[a].id - traces[b].id);
    idx.forEach((pkg, k) => (queueIndex[pkg] = k));
    queueByStation.set(station, idx.length);
  }
  for (const idx of strands.values()) {
    idx.sort((a, b) => traces[a].steps[traces[a].steps.length - 1].end - traces[b].steps[traces[b].steps.length - 1].end || traces[a].id - traces[b].id);
    idx.forEach((pkg, k) => (strandIndex[pkg] = k));
  }
  return { t, views, queueIndex, strandIndex, queueByStation, serviceByStation, shipped, queued, damaged, stranded };
}

/** Playback end: the last shipment across the given traces (falls back to the last recorded event). */
export function playbackEnd(...traceSets: PackageTrace[][]): number {
  let end = 0;
  let anyShipped = false;
  for (const traces of traceSets) {
    for (const p of traces) {
      if (p.shippedAt !== null) {
        anyShipped = true;
        end = Math.max(end, p.shippedAt);
      }
    }
  }
  if (anyShipped) return end;
  for (const traces of traceSets) {
    for (const p of traces) for (const s of p.steps) end = Math.max(end, s.end, s.enter);
  }
  return end;
}
