import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { CallCapError, makeCallGuard } from "../src/agents/call-guard.ts";
import type { Proposal } from "../src/agents/designer.ts";
import { solve } from "../src/loop/solve.ts";
import { meteredEvaluate, meteredSimulate, setSimCap, SimCapError, simUsed } from "../src/loop/meter.ts";
import { makeScenario } from "../src/sim/scenarios.ts";
import { loadTaskA, validateForTask } from "../src/tasks/task.ts";

test("call guard counts attempts (including failures) and refuses at the cap", async () => {
  let underlyingCalls = 0;
  const g = makeCallGuard((async () => {
    underlyingCalls++;
    if (underlyingCalls === 2) throw new Error("transport failure");
    return {} as never;
  }) as never);
  g.setCap(3);
  await g.call("a", {} as never);
  await assert.rejects(g.call("a", {} as never), /transport failure/);
  await g.call("a", {} as never);
  assert.equal(g.used(), 3, "failed attempt counted");
  assert.throws(() => g.call("a", {} as never), CallCapError);
  assert.equal(underlyingCalls, 3, "the 4th call never reached the provider");
});

test("simulator cap refuses the next charged evaluation; replay/baseline rendering is not charged", () => {
  const t = loadTaskA();
  setSimCap(2);
  meteredEvaluate("candidate", t.initial, "train");
  meteredEvaluate("attribution", t.initial, "train");
  meteredEvaluate("baseline", t.initial, "train");
  meteredSimulate("replay", t.initial, makeScenario(1, "normal"));
  assert.equal(simUsed(), 2);
  assert.throws(() => meteredEvaluate("probe", t.initial, "train"), SimCapError);
  setSimCap(null);
});

test("solve never exceeds its simulator cap and records why it stopped", async () => {
  const task = loadTaskA();
  const runId = `test-caps-${process.pid}`;
  const heuristic = { ...task.initial, stations: task.initial.stations.map((s) => (s.kind === "pack" ? { ...s, sizes: ["S", "M", "L"] as ("S" | "M" | "L")[] } : s)) };
  let n = 0;
  const summary = await solve({
    task, generations: 6, runId, log: () => {}, research: false, reflect: false, maxSimEvals: 12,
    deps: {
      propose: async ({ lens }) => {
        // Distinct valid layouts so every proposal is scored (no duplicates).
        const l = { ...heuristic, stations: heuristic.stations.map((s) => (s.id === "sort-1" ? { ...s, x: 4 + (n++ % 15), y: 3 + (n % 8) } : s)) };
        return { designer: lens.id, model: "scripted", rationale: "", appliedLessons: [], prediction: {}, layout: l, errors: validateForTask(l, task), via: "tool", toolReceipts: [], probes: [] } as Proposal;
      },
    },
  });
  assert.ok((summary.simCalls as { chargedToCap: number }).chargedToCap <= 12, "hard cap held");
  assert.match(summary.stopReason, /simulator (budget|cap)/);
  rmSync(`runs/${runId}`, { recursive: true, force: true });
});

test("transient retry: one retry for 429 and connection errors, none for other failures", async () => {
  const { retryTransient, isTransient } = await import("../src/agents/retry.ts");
  assert.ok(isTransient({ status: 429 }));
  assert.ok(isTransient({ name: "APIConnectionError", message: "Connection error." }));
  assert.ok(!isTransient({ status: 400, message: "bad request" }));
  assert.ok(!isTransient({ status: 500, message: "Connection error." }), "an HTTP status means the server answered");
  let n = 0;
  assert.equal(await retryTransient(async () => { if (n++ === 0) throw Object.assign(new Error("Connection error."), { name: "APIConnectionError" }); return "ok"; }, 1), "ok");
  let m = 0;
  await assert.rejects(retryTransient(async () => { m++; throw Object.assign(new Error("Connection error."), { name: "APIConnectionError" }); }, 1));
  assert.equal(m, 2, "exactly one retry");
  let k = 0;
  await assert.rejects(retryTransient(async () => { k++; throw Object.assign(new Error("bad"), { status: 400 }); }, 1));
  assert.equal(k, 1, "non-transient errors are not retried");
});

test("solve classifies failed proposals: provider failure vs budget failure vs equal arm-cap stop", async () => {
  const task = loadTaskA();
  const fail = (designer: string, msg: string): Proposal => ({ designer, model: "scripted", rationale: "", appliedLessons: [], prediction: {}, layout: null, errors: [`model call failed: ${msg}`], via: "failed", toolReceipts: [], probes: [] });
  const msgs: Record<string, string> = { flow: "Connection error.", quality: "spend cap reached: 25/210 attempts", capacity: "run call cap reached (26/26)" };
  const runId = `test-classify-${process.pid}`;
  const s = await solve({ task, generations: 1, runId, log: () => {}, research: false, reflect: false, deps: { propose: async ({ lens }) => fail(lens.id, msgs[lens.id]) } });
  assert.equal(s.providerFailures, 1);
  assert.equal(s.budgetFailures, 1);
  assert.equal(s.armCapHits, 1);
  rmSync(`runs/${runId}`, { recursive: true, force: true });
});
