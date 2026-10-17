import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ReplayBundle } from "../src/replay.ts";
import type { PackageTrace } from "../src/sim/types.ts";
import { damagedAt, frameAt, legPosition, playbackEnd, stateAt } from "../web/world/state.ts";

const bundle = JSON.parse(readFileSync("runs/sample/replay.json", "utf8")) as ReplayBundle;
const layout = bundle.baseline.layout;
const trace = bundle.baseline.result.trace;
const pkg = (id: number) => trace.find((p) => p.id === id)!;
const sides = [bundle.baseline, bundle.improved];

/** The hand-computed cases below were worked out from this exact fixture; skip them if it is regenerated with a different sim. */
const pinned =
  JSON.stringify(pkg(18)?.steps) ===
    JSON.stringify([
      { station: "recv-1", enter: 1, start: 1, end: 7 },
      { station: "sort-1", enter: 57, start: 57, end: 61 },
      { station: "pack-1", enter: 97, start: 97, end: 117 },
      { station: "ship-B", enter: 125, start: 125, end: 130 },
    ]) &&
  JSON.stringify(pkg(1)?.legs[2]) === JSON.stringify({ from: "pack-1", to: "ship-A", t0: 147, t1: 211, cells: 32 }) &&
  JSON.stringify(layout.stations.map((s) => [s.id, s.x, s.y])) ===
    JSON.stringify([["recv-1", 0, 7], ["sort-1", 20, 2], ["pack-1", 2, 2], ["pack-2", 4, 11], ["ship-A", 23, 13], ["ship-B", 0, 0], ["ship-C", 12, 0]]);

test("hand-computed: package 18 before arrival, in service, mid-leg (L-shape), shipped", (t) => {
  if (!pinned) return t.skip("sample fixture regenerated; hand-computed values no longer apply");
  const p = pkg(18);
  // arrival 1
  assert.equal(stateAt(p, layout, 0.5).state, "not_arrived");
  assert.deepEqual(stateAt(p, layout, 1), { state: "in_service", station: "recv-1", position: { x: 0, z: 7 }, step: 0, progress: 0 });
  // recv-1 (0,7) -> sort-1 (20,2): 25 cells over t 7..57 = 2 s/cell; x first, then y.
  assert.deepEqual(stateAt(p, layout, 27).position, { x: 10, z: 7 }); // 10 cells along x
  assert.deepEqual(stateAt(p, layout, 47).position, { x: 20, z: 7 }); // the corner, 20 cells
  assert.deepEqual(stateAt(p, layout, 51).position, { x: 20, z: 5 }); // 22 cells: 2 down the y run
  assert.equal(stateAt(p, layout, 51).state, "traveling");
  assert.equal(stateAt(p, layout, 51).station, "sort-1");
  // ship-B service 125..130, shippedAt 130
  assert.equal(stateAt(p, layout, 129.9).state, "in_service");
  assert.equal(stateAt(p, layout, 129.9).station, "ship-B");
  const done = stateAt(p, layout, 130);
  assert.equal(done.state, "shipped");
  assert.deepEqual(done.position, { x: 0, z: 0 });
});

test("hand-computed: package 1 queued behind 18, in service at pack-1, mid-leg on the y run", (t) => {
  if (!pinned) return t.skip("sample fixture regenerated");
  const p = pkg(1);
  // recv-1 enter 5, start 7 (package 18 occupies the dock until 7)
  const q = stateAt(p, layout, 6);
  assert.equal(q.state, "queued");
  assert.equal(q.station, "recv-1");
  assert.equal(q.progress, 0.5);
  // pack-1 service 117..147
  const s = stateAt(p, layout, 120);
  assert.equal(s.state, "in_service");
  assert.equal(s.station, "pack-1");
  assert.equal(s.progress, 0.1);
  // pack-1 (2,2) -> ship-A (23,13): 32 cells over 147..211; corner at 21 cells = t 189
  assert.deepEqual(stateAt(p, layout, 189).position, { x: 23, z: 2 });
  assert.deepEqual(stateAt(p, layout, 199).position, { x: 23, z: 7 }); // 26 cells: 5 into the y run
  assert.equal(stateAt(p, layout, 211).state, "queued"); // reached ship-A at 211, service starts 214
});

test("hand-computed: queue order at recv-1 is by enter time", (t) => {
  if (!pinned) return t.skip("sample fixture regenerated");
  // t=26: 57 in service (25..31); 70 (enter 21), 79 (enter 22), 52 (enter 26) waiting.
  const f = frameAt(trace, layout, 26);
  const qi = (id: number) => f.queueIndex[trace.findIndex((p) => p.id === id)];
  assert.equal(f.serviceByStation.get("recv-1"), trace.findIndex((p) => p.id === 57));
  assert.deepEqual([qi(70), qi(79), qi(52)], [0, 1, 2]);
  assert.equal(f.queueByStation.get("recv-1"), 3);
});

test("hand-computed: fragile package 17 turns damaged after its first over-long leg", (t) => {
  if (!pinned) return t.skip("sample fixture regenerated");
  // recv-1 -> sort-1 is 25 cells (> 12), arriving at 69.
  assert.equal(damagedAt(pkg(17)), 69);
  assert.equal(damagedAt(pkg(18)), null);
});

test("legPosition walks x first, then y, at constant speed", () => {
  const a = { x: 2, z: 2 };
  const b = { x: 5, z: 0 };
  assert.deepEqual(legPosition(a, b, 0), a);
  assert.deepEqual(legPosition(a, b, 0.2), { x: 3, z: 2 });
  assert.deepEqual(legPosition(a, b, 0.6), { x: 5, z: 2 });
  assert.deepEqual(legPosition(a, b, 0.8), { x: 5, z: 1 });
  assert.deepEqual(legPosition(a, b, 1), b);
});

const isVisible = (p: PackageTrace, l: typeof layout, t: number) => stateAt(p, l, t).state !== "not_arrived";

test("every package's first visible time equals its arrival (both floors)", () => {
  for (const side of sides) {
    for (const p of side.result.trace) {
      assert.equal(isVisible(p, side.layout, p.arrival - 1e-6), false, `pkg ${p.id} visible before arrival`);
      assert.equal(isVisible(p, side.layout, p.arrival), true, `pkg ${p.id} hidden at arrival`);
      // Scanning on a fine grid finds the same first-visible instant.
      let first = Number.NaN;
      for (let t = 0; t <= p.arrival + 1; t += 0.25) {
        if (isVisible(p, side.layout, t)) {
          first = t;
          break;
        }
      }
      assert.equal(first, p.arrival, `pkg ${p.id}`);
    }
  }
});

test("states follow the trace exactly for every package and step boundary", () => {
  for (const side of sides) {
    const byId = new Map(side.layout.stations.map((s) => [s.id, s]));
    for (const p of side.result.trace) {
      p.steps.forEach((s, i) => {
        if (s.start > s.enter) assert.equal(stateAt(p, side.layout, s.enter).state, "queued");
        if (s.end > s.start) assert.equal(stateAt(p, side.layout, s.start).state, "in_service");
        const at = stateAt(p, side.layout, (s.start + s.end) / 2);
        if (s.end > s.start) assert.equal(at.station, s.station);
        const leg = p.legs[i];
        if (leg) {
          const from = byId.get(leg.from)!;
          const to = byId.get(leg.to)!;
          assert.equal(leg.cells, Math.abs(to.x - from.x) + Math.abs(to.y - from.y), "cells is the Manhattan distance");
          const mid = stateAt(p, side.layout, (leg.t0 + leg.t1) / 2);
          assert.equal(mid.state, "traveling");
          assert.ok(mid.position.z === from.y || mid.position.x === to.x, "on the L path");
          assert.deepEqual(stateAt(p, side.layout, leg.t0).position, { x: from.x, z: from.y });
          assert.deepEqual(stateAt(p, side.layout, leg.t1).position, { x: to.x, z: to.y });
        }
      });
      const end = p.steps[p.steps.length - 1].end;
      assert.equal(stateAt(p, side.layout, end).state, p.shippedAt !== null ? "shipped" : "stranded");
    }
  }
});

test("frame counters agree with the scored metrics at the end of playback", () => {
  const end = Math.max(playbackEnd(bundle.baseline.result.trace, bundle.improved.result.trace), ...sides.flatMap((s) => s.result.trace.flatMap((p) => p.steps.map((st) => st.end))));
  for (const side of sides) {
    const f = frameAt(side.result.trace, side.layout, end);
    assert.equal(f.shipped, side.result.metrics.shipped);
    assert.equal(f.damaged, side.result.metrics.damaged);
    assert.equal(f.stranded, side.result.metrics.unshipped);
  }
});
