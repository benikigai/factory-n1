import { OBJECTIVE, SIM } from "./config.ts";
import { distance } from "./layout.ts";
import type { Layout, Package, PackageTrace, RunMetrics, RunResult, Scenario, Station } from "./types.ts";

interface Event {
  t: number;
  seq: number;
  kind: "arrive" | "done";
  pkg: number;
  station: string;
}

/** Binary min-heap ordered by (time, insertion order) so ties replay identically. */
class EventQueue {
  private heap: Event[] = [];
  private seq = 0;
  get size() {
    return this.heap.length;
  }
  push(e: Omit<Event, "seq">) {
    this.heap.push({ ...e, seq: this.seq++ });
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.heap[p], this.heap[i])) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }
  pop(): Event {
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heap.length && this.less(this.heap[l], this.heap[m])) m = l;
        if (r < this.heap.length && this.less(this.heap[r], this.heap[m])) m = r;
        if (m === i) break;
        [this.heap[m], this.heap[i]] = [this.heap[i], this.heap[m]];
        i = m;
      }
    }
    return top;
  }
  private less(a: Event, b: Event) {
    return a.t < b.t || (a.t === b.t && a.seq < b.seq);
  }
}

interface StationState {
  def: Station;
  busy: boolean;
  queue: number[];
  busyTime: number;
  totalWait: number;
  maxQueue: number;
  processed: number;
}

function serviceTime(s: Station, p: Package): number {
  return s.kind === "pack" ? SIM.service.pack[p.size] : SIM.service[s.kind];
}

/**
 * Deterministic discrete-event simulation of receive -> sort -> pack -> ship.
 * This is the independent grader: agents propose layouts, only this code scores them.
 */
export function simulate(layout: Layout, scenario: Scenario): RunResult {
  const states = new Map<string, StationState>();
  for (const def of layout.stations) {
    states.set(def.id, { def, busy: false, queue: [], busyTime: 0, totalWait: 0, maxQueue: 0, processed: 0 });
  }
  const byKind = (k: Station["kind"]) => [...states.values()].filter((s) => s.def.kind === k);
  const load = (s: StationState) => s.queue.length + (s.busy ? 1 : 0);
  /** Least-loaded candidate, ties broken by distance then id, so routing is deterministic. */
  const choose = (from: Station, candidates: StationState[]) =>
    [...candidates].sort(
      (a, b) => load(a) - load(b) || distance(from, a.def) - distance(from, b.def) || a.def.id.localeCompare(b.def.id),
    )[0];

  const pkgs = scenario.packages;
  const traces: PackageTrace[] = pkgs.map((p) => ({
    id: p.id,
    zone: p.zone,
    size: p.size,
    fragile: p.fragile,
    arrival: p.arrival,
    shippedAt: null,
    damaged: false,
    missorted: false,
    steps: [],
    legs: [],
  }));
  let travelCells = 0;

  const q = new EventQueue();
  const receiving = byKind("receiving");
  for (const p of pkgs) {
    // Packages land at the least-busy receiving dock; decided at arrival time below.
    q.push({ t: p.arrival, kind: "arrive", pkg: p.id, station: "" });
  }

  const start = (t: number, st: StationState, pkg: number) => {
    st.busy = true;
    const step = traces[pkg].steps[traces[pkg].steps.length - 1];
    step.start = t;
    st.totalWait += t - step.enter;
    q.push({ t: t + serviceTime(st.def, pkgs[pkg]), kind: "done", pkg, station: st.def.id });
  };

  const next = (st: StationState, pkg: number): StationState | null | "stuck" => {
    const p = pkgs[pkg];
    switch (st.def.kind) {
      case "receiving":
        return choose(st.def, byKind("sorter"));
      case "sorter": {
        const packs = byKind("pack");
        const eligible = packs.filter((s) => s.def.zones!.includes(p.zone) && s.def.sizes!.includes(p.size));
        if (eligible.length) return choose(st.def, eligible);
        // No station is set up for this package: it gets packed wrong.
        traces[pkg].missorted = true;
        return choose(st.def, packs);
      }
      case "pack": {
        const docks = byKind("shipping").filter((s) => s.def.zones!.includes(p.zone));
        return docks.length ? choose(st.def, docks) : "stuck";
      }
      case "shipping":
        return null;
    }
  };

  while (q.size) {
    const e = q.pop();
    if (e.kind === "arrive") {
      const st = e.station ? states.get(e.station)! : choose({ id: "", kind: "receiving", x: 0, y: 0 }, receiving);
      traces[e.pkg].steps.push({ station: st.def.id, enter: e.t, start: -1, end: -1 });
      if (st.busy) {
        st.queue.push(e.pkg);
        st.maxQueue = Math.max(st.maxQueue, st.queue.length);
      } else {
        start(e.t, st, e.pkg);
      }
      continue;
    }

    const st = states.get(e.station)!;
    const trace = traces[e.pkg];
    const step = trace.steps[trace.steps.length - 1];
    step.end = e.t;
    st.busy = false;
    st.busyTime += e.t - step.start;
    st.processed++;

    const to = next(st, e.pkg);
    if (to === null) {
      trace.shippedAt = e.t;
    } else if (to !== "stuck") {
      const cells = distance(st.def, to.def);
      travelCells += cells;
      if (pkgs[e.pkg].fragile && cells > SIM.fragileMaxLeg) trace.damaged = true;
      const arriveAt = e.t + cells * SIM.secondsPerCell;
      trace.legs.push({ from: st.def.id, to: to.def.id, t0: e.t, t1: arriveAt, cells });
      q.push({ t: arriveAt, kind: "arrive", pkg: e.pkg, station: to.def.id });
    }

    const waiting = st.queue.shift();
    if (waiting !== undefined) start(e.t, st, waiting);
  }

  return { scenario: { id: scenario.id, seed: scenario.seed, profile: scenario.profile }, metrics: measure(layout, states, traces, travelCells), trace: traces };
}

function measure(layout: Layout, states: Map<string, StationState>, traces: PackageTrace[], travelCells: number): RunMetrics {
  const shipped = traces.filter((t) => t.shippedAt !== null);
  const firstArrival = Math.min(...traces.map((t) => t.arrival));
  const lastArrival = Math.max(...traces.map((t) => t.arrival));
  const lastShip = shipped.length ? Math.max(...shipped.map((t) => t.shippedAt!)) : lastArrival;
  const makespan = lastShip - firstArrival;
  const missorts = traces.filter((t) => t.missorted).length;
  const damaged = traces.filter((t) => t.damaged).length;
  const unshipped = traces.length - shipped.length;
  const capex = layout.stations.reduce((sum, s) => sum + SIM.capex[s.kind], 0);
  const waits = traces.flatMap((t) => t.steps.filter((s) => s.start >= 0).map((s) => s.start - s.enter));

  const stations: RunMetrics["stations"] = {};
  let bottleneck = "";
  let worstWait = -1;
  for (const [id, s] of states) {
    stations[id] = {
      kind: s.def.kind,
      processed: s.processed,
      utilization: makespan > 0 ? round(s.busyTime / makespan) : 0,
      maxQueue: s.maxQueue,
      totalWait: s.totalWait,
    };
    if (s.totalWait > worstWait) {
      worstWait = s.totalWait;
      bottleneck = id;
    }
  }

  const objective =
    makespan +
    OBJECTIVE.missort * missorts +
    OBJECTIVE.damaged * damaged +
    OBJECTIVE.unshipped * unshipped +
    capex / OBJECTIVE.capexPerSecond;

  return {
    packages: traces.length,
    shipped: shipped.length,
    unshipped,
    missorts,
    damaged,
    makespan,
    drainTime: lastShip - lastArrival,
    throughputPerHour: makespan > 0 ? round((shipped.length / makespan) * 3600) : 0,
    avgCycleTime: shipped.length ? round(shipped.reduce((a, t) => a + (t.shippedAt! - t.arrival), 0) / shipped.length) : 0,
    avgWait: waits.length ? round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
    maxQueue: Math.max(0, ...Object.values(stations).map((s) => s.maxQueue)),
    travelCells,
    capex,
    objective: round(objective),
    bottleneck,
    stations,
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
