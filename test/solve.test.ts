import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import type { Proposal } from "../src/agents/designer.ts";
import { solve } from "../src/loop/solve.ts";
import { reduce, render, retirements, type MemoryOp } from "../src/memory/store.ts";
import type { ReplayBundle } from "../src/replay.ts";
import { scenariosFor } from "../src/sim/scenarios.ts";
import type { Layout } from "../src/sim/types.ts";
import { loadTaskA, validateForTask } from "../src/tasks/task.ts";

const task = loadTaskA();
const heuristic: Layout = { ...task.initial, stations: task.initial.stations.map((s) => (s.kind === "pack" ? { ...s, sizes: ["S", "M", "L"] } : s)) };
const movedDock: Layout = { ...task.initial, stations: task.initial.stations.map((s) => (s.id === "ship-A" ? { ...s, x: 20 } : s)) };
// Worse than the heuristic: same coverage, but the sorter is pushed into the far corner.
const worse: Layout = { ...heuristic, stations: heuristic.stations.map((s) => (s.kind === "sorter" ? { ...s, x: 22, y: 11 } : s)) };

const P = (designer: string, layout: Layout, extra: Partial<Proposal> = {}): Proposal => ({
  designer, model: "scripted", rationale: `scripted ${designer}`, appliedLessons: [], prediction: { objective: 1000 },
  layout, errors: validateForTask(layout, task), via: "tool", toolReceipts: [], probes: [], ...extra,
});

const script: Record<string, Proposal>[] = [
  { flow: P("flow", movedDock), capacity: P("capacity", heuristic, { appliedLessons: ["EXT-plan-1"] }) },
  { flow: P("flow", heuristic), capacity: P("capacity", worse) },
  { flow: P("flow", worse), capacity: P("capacity", task.initial) },
  { flow: P("flow", worse), capacity: P("capacity", worse) },
];

test("full loop offline: research -> memory -> proposals -> grader -> accept/reject -> memory -> replay", async () => {
  const runId = `test-solve-${process.pid}`;
  rmSync(`runs/${runId}`, { recursive: true, force: true });
  let gen = 0;
  let lens = 0;
  const summary = await solve({
    task, generations: 4, runId, log: () => {},
    deps: {
      research: async ({ idPrefix }) => ({
        ops: [{ op: "add_external", id: `${idPrefix}-1`, text: "Match pack capability to the size mix.", testableAs: "allow L at pack stations",
          sources: [{ url: "https://example.org/a", title: "A", excerpts: ["x"] }], query: "q", retrievedAt: "t", toolReceiptId: "call_1" }],
        query: "q", sources: [], receiptId: "call_1", citationRepairs: 0, dropped: [],
      }),
      propose: async ({ lens: l }) => {
        const p = script[gen][l.id];
        if (++lens % 2 === 0) gen++;
        return p;
      },
      reflect: async ({ id, evidence }) => ({ op: "add_verified", id, text: "size coverage removes mis-sorts", scope: "factory-a", evidence, author: "scripted" }),
      // The hypothesis can't be turned into an isolated intervention, so it is never tested.
      testHypothesis: async () => ({ op: null, layout: null, train: null, select: null, improved: false, untestable: "scripted: untestable", simEvals: 0 }),
    },
  });

  assert.equal(summary.accepted, 1, "exactly one accepted change");
  assert.ok(summary.champion.select < summary.baseline.select * 0.8, "champion beats baseline on validation days");
  const bundle = JSON.parse(readFileSync(`runs/${runId}/replay.json`, "utf8")) as ReplayBundle;
  assert.equal(bundle.mode, "recorded");
  assert.notDeepEqual(bundle.improved.layout, bundle.baseline.layout);
  assert.equal(bundle.baseline.result.scenario.id, bundle.improved.result.scenario.id, "same scenario for both floors");
  const reasons = bundle.rejected.map((r) => r.reason).join(" | ");
  assert.match(reasons, /invalid: ship-A is a fixed dock/);
  assert.match(reasons, /duplicate/);
  assert.match(reasons, /not better than champion|not the best/);
  assert.ok(bundle.accepted[0].edits.every((e) => e.edit.includes("sizes")), "receipts credit the size edits");
  assert.ok(bundle.accepted[0].edits.every((e) => e.deltaAlone < 0));
  assert.equal(bundle.comparators.length, 2);

  const mem = JSON.parse(readFileSync(`runs/${runId}/memory.json`, "utf8"));
  const ext = mem.state.lessons.find((l: any) => l.id === "EXT-plan-1");
  // Regression (independent verification, live-a-2): a winning proposal that CITES a hypothesis is not
  // evidence the hypothesis was implemented or caused the win. It must stay an untested hypothesis.
  assert.equal(ext.status, "hypothesis", "cited-but-untested hypothesis is never promoted");
  assert.equal(ext.basis, "untested");
  assert.equal(ext.cited, 1);
  assert.equal(ext.citedInAccepted, 1);
  assert.equal(ext.trials, 0);
  const observed = mem.state.lessons.find((l: any) => l.id === "VER-g1");
  assert.equal(observed.basis, "observed-from-experiment");
  assert.ok(bundle.lessons.find((l) => l.id === "EXT-plan-1")!.kind === "external", "viewer shows it as external");

  const records = readFileSync(`runs/${runId}/experiments.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(records.length >= 6);
  assert.ok(records.every((r) => r.graderHash && r.simVersion === "1.1.0" && r.dataUse.includes("never final")));
  assert.throws(() => scenariosFor("final"), /locked/, "the loop never unlocks the final split");
  assert.ok(existsSync(`runs/${runId}/summary.json`));
  rmSync(`runs/${runId}`, { recursive: true, force: true });
});

test("memory: only an isolated test promotes; citations never do; failed tests retire", () => {
  const ext: MemoryOp = { op: "add_external", id: "E1", text: "t", testableAs: "x", sources: [{ url: "https://u", title: "u", excerpts: [] }], query: "q", retrievedAt: "r", toolReceiptId: "c" };
  const win = { gen: 1, candidateId: "c1", accepted: true, deltaSelect: -900 };
  const cited: MemoryOp[] = [ext, { op: "cited", id: "E1", evidence: win }, { op: "cited", id: "E1", evidence: win }];
  assert.deepEqual(reduce(cited), reduce(JSON.parse(JSON.stringify(cited))), "deterministic");
  assert.equal(reduce(cited).lessons[0].status, "hypothesis", "two winning citations still don't promote");
  assert.equal(render(reduce(cited)), render(reduce(cited)), "byte-stable render");
  // A non-isolated "test" is ignored.
  const fake: MemoryOp = { op: "tested", id: "E1", improved: true, evidence: { ...win, isolated: false } };
  assert.equal(reduce([...cited, fake]).lessons[0].status, "hypothesis");
  // An isolated improving test promotes, with its basis recorded.
  const pass: MemoryOp = { op: "tested", id: "E1", improved: true, evidence: { gen: 1, candidateId: "test-E1", accepted: false, deltaSelect: -500, isolated: true, edits: [{ edit: "pack-1 sizes M,S -> L,M,S", deltaAlone: -400 }] } };
  const promoted = reduce([...cited, pass]).lessons[0];
  assert.equal(promoted.status, "verified");
  assert.equal(promoted.basis, "isolated-test");
  // An isolated test with no improvement leaves it a hypothesis, and retirement removes it.
  const fail: MemoryOp = { op: "tested", id: "E1", improved: false, evidence: { gen: 1, candidateId: "test-E1", accepted: false, deltaSelect: 30, isolated: true } };
  assert.equal(reduce([...cited, fail]).lessons[0].status, "hypothesis");
  assert.deepEqual(retirements(reduce([...cited, fail])).map((o) => o.op), ["retire"]);
});

test("isolated hypothesis test that improves validation is adopted and promoted", async () => {
  const runId = `test-solve-adopt-${process.pid}`;
  rmSync(`runs/${runId}`, { recursive: true, force: true });
  const { evaluate } = await import("../src/sim/evaluate.ts");
  const { DEFAULT_DOD } = await import("../src/sim/dod.ts");
  const summary = await solve({
    task, generations: 1, runId, log: () => {},
    deps: {
      research: async ({ idPrefix }) => ({
        ops: [{ op: "add_external", id: `${idPrefix}-1`, text: "Let pack stations accept large boxes.", testableAs: "add L to pack sizes",
          sources: [{ url: "https://example.org/a", title: "A", excerpts: [] }], query: "q", retrievedAt: "t", toolReceiptId: "call_1" }],
        query: "q", sources: [], receiptId: "call_1", citationRepairs: 0, dropped: [],
      }),
      testHypothesis: async ({ lesson, championSelect }) => {
        const select = evaluate(heuristic, "select", DEFAULT_DOD);
        return {
          op: { op: "tested", id: lesson.id, improved: true, evidence: { gen: 0, candidateId: `test-${lesson.id}`, accepted: false, deltaSelect: select.objective - championSelect.objective, isolated: true, edits: [{ edit: "pack-1 sizes M,S -> L,M,S", deltaAlone: -4700 }] } },
          layout: heuristic, train: evaluate(heuristic, "train", DEFAULT_DOD), select, improved: true, simEvals: 2,
        };
      },
      propose: async ({ lens }) => P(lens.id, task.initial),
      reflect: async () => null,
    },
  });
  assert.equal(summary.champion.id, "test-EXT-plan-1", "the tested hypothesis became the champion");
  const mem = JSON.parse(readFileSync(`runs/${runId}/memory.json`, "utf8"));
  const l = mem.state.lessons.find((x: any) => x.id === "EXT-plan-1");
  assert.equal(l.status, "verified");
  assert.equal(l.basis, "isolated-test");
  rmSync(`runs/${runId}`, { recursive: true, force: true });
});

test("memory: a verified lesson is not retired by later proposals that cite it", () => {
  const ok = { gen: 1, candidateId: "g1", accepted: true, deltaSelect: -9000 };
  const miss = (g: number) => ({ gen: g, candidateId: `g${g}`, accepted: false, deltaSelect: 10 });
  const ops: MemoryOp[] = [
    { op: "add_verified", id: "V1", text: "sorter near receiving helps", scope: "a", evidence: ok, author: "t" },
    ...[2, 3, 4, 5].map((g) => ({ op: "cited", id: "V1", evidence: miss(g) }) as MemoryOp),
  ];
  const state = reduce(ops);
  assert.equal(state.lessons[0].status, "verified");
  assert.equal(retirements(state).length, 0);
  assert.equal(state.lessons[0].cited, 4, "citations are counted, not treated as evidence");
});
