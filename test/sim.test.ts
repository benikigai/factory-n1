import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_DOD, evaluateDoD } from "../src/sim/dod.ts";
import { simulate } from "../src/sim/engine.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { validateLayout } from "../src/sim/layout.ts";
import { makeScenario } from "../src/sim/scenarios.ts";
import type { Layout } from "../src/sim/types.ts";

const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Layout;
const baseline = load("layouts/baseline.json");
const reference = load("test/fixtures/reference.json");

test("same layout and seed replay identically", () => {
  const s = makeScenario(7, "peak");
  assert.deepEqual(simulate(baseline, s), simulate(baseline, makeScenario(7, "peak")));
});

test("every package is accounted for", () => {
  for (const profile of ["normal", "peak", "fragile", "skewed"] as const) {
    const m = simulate(reference, makeScenario(3, profile)).metrics;
    assert.equal(m.shipped + m.unshipped, 100);
  }
});

test("trace legs are continuous in time", () => {
  const { trace } = simulate(baseline, makeScenario(2, "normal"));
  for (const p of trace) {
    for (let i = 0; i < p.steps.length; i++) {
      const st = p.steps[i];
      assert.ok(st.enter <= st.start && st.start <= st.end, `pkg ${p.id} step ${i}`);
      if (i > 0) assert.equal(p.legs[i - 1].t1, st.enter);
    }
  }
});

test("validator rejects broken layouts", () => {
  const bad: Layout = {
    ...baseline,
    stations: baseline.stations.map((s) => (s.id === "recv-1" ? { ...s, x: 5, y: 5 } : s)),
  };
  assert.ok(validateLayout(bad).some((e) => e.includes("outer wall")));
  assert.equal(evaluate(bad, "train").objective, Infinity);
});

test("dock with no zone coverage leaves packages unshipped and fails the floor check", () => {
  const noC: Layout = { ...reference, stations: reference.stations.filter((s) => s.id !== "ship-C") };
  const e = evaluate(noC, "train", DEFAULT_DOD);
  assert.ok(e.results.every((r) => r.metrics.unshipped > 0));
  assert.equal(e.dod!.checks.find((c) => c.id === "all-shipped")!.passed, false);
});

test("planner cannot drop the floor check", () => {
  const weakened = { goal: "anything", checks: [] };
  const results = evaluate(baseline, "train").results;
  assert.ok(evaluateDoD(weakened, results).checks.some((c) => c.id === "all-shipped"));
});

test("baseline fails the default DoD; hand-built reference passes on unseen test days", () => {
  assert.equal(evaluate(baseline, "train", DEFAULT_DOD).dod!.passed, false);
  const test = evaluate(reference, "test", DEFAULT_DOD);
  assert.equal(test.dod!.passed, true);
  assert.ok(test.objective < evaluate(baseline, "test").objective / 3);
});

// Regression for the package-identity bug (events indexed by id into arrays sorted by arrival).
// Every trace must describe exactly the scenario package with its id, with physically consistent timing.
test("traces preserve package identity, arrival, service times and routing rules", async () => {
  const { SIM } = await import("../src/sim/config.ts");
  for (const layout of [baseline, reference]) {
    const kindOf = new Map(layout.stations.map((s) => [s.id, s]));
    for (const profile of ["normal", "peak", "fragile", "skewed"] as const) {
      const scenario = makeScenario(11, profile);
      const { trace } = simulate(layout, scenario);
      assert.equal(trace.length, scenario.packages.length);
      assert.equal(new Set(trace.map((t) => t.id)).size, trace.length, "unique ids");
      const byId = new Map(scenario.packages.map((p) => [p.id, p]));
      for (const t of trace) {
        const p = byId.get(t.id)!;
        const where = `${layout.name}/${profile}/pkg ${t.id}`;
        assert.deepEqual([t.zone, t.size, t.fragile, t.arrival], [p.zone, p.size, p.fragile, p.arrival], where);
        assert.equal(t.steps[0].enter, p.arrival, `${where} enters receiving at its arrival`);
        const kinds = t.steps.map((s) => kindOf.get(s.station)!.kind);
        if (t.shippedAt !== null) assert.deepEqual(kinds, ["receiving", "sorter", "pack", "shipping"], where);
        for (const s of t.steps) {
          const st = kindOf.get(s.station)!;
          const expected = st.kind === "pack" ? SIM.service.pack[p.size] : SIM.service[st.kind];
          assert.equal(s.end - s.start, expected, `${where} service at ${s.station}`);
        }
        const pack = t.steps.find((s) => kindOf.get(s.station)!.kind === "pack");
        if (pack) {
          const ps = kindOf.get(pack.station)!;
          const accepts = ps.zones!.includes(p.zone) && ps.sizes!.includes(p.size);
          const anyAccepts = layout.stations.some((s) => s.kind === "pack" && s.zones!.includes(p.zone) && s.sizes!.includes(p.size));
          assert.equal(t.missorted, !anyAccepts, `${where} missorted iff no station accepts it`);
          if (!t.missorted) assert.ok(accepts, `${where} packed at an accepting station`);
        }
        const ship = t.steps.find((s) => kindOf.get(s.station)!.kind === "shipping");
        if (ship) assert.ok(kindOf.get(ship.station)!.zones!.includes(p.zone), `${where} shipped from its zone's dock`);
        assert.equal(t.damaged, p.fragile && t.legs.some((l) => l.cells > SIM.fragileMaxLeg), `${where} damage rule`);
      }
    }
  }
});
