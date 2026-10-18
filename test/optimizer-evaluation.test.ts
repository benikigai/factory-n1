import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { graderHash } from "../src/sim/version.ts";
import type { DemandDay } from "../src/training/critic.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "../src/training/generate.ts";
import { legalMoveActions, type OptimizerCase } from "../src/training/optimizer-data.ts";
import { applyAction, betterCandidate, measureLayout, OPTIMIZER_PROMPT_PROFILE } from "../src/training/optimizer.ts";
import { freezeOptimizerEvaluation, readOptimizerCases, runOptimizerEvaluation, validateOptimizerHealth, type OptimizerEvaluationOptions, type OptimizerEvaluationPlan, type OptimizerProvenance } from "../src/training/optimizer-evaluate.ts";

function fixture(override: Partial<OptimizerEvaluationOptions> = {}, count = 1) {
  const root = resolve("runs/optimizer-eval"); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, ".test-")), data = join(directory, "data"); mkdirSync(data);
  const days = (seed: number): DemandDay[] => (["normal", "peak", "fragile", "skewed"] as const).map((profile, i) => ({ seed: seed + i, profile, count: 100 }));
  // Entirely separate toy factories. These tests never open the actual optimizer or critic test data.
  const cases: OptimizerCase[] = Array.from({ length: count }, (_, i) => {
    const task = generateBuilding(845139 + i * 1009, `toy-${i}`);
    const action = legalMoveActions(task, task.initial, 4501 + i, 1)[0];
    const initial = applyAction(task, task.initial, action);
    return { id: task.id, split: "test", buildingId: task.id, buildingHash: buildingHash(task), geometrySeed: 845139 + i * 1009, initialLayoutHash: layoutHash(initial), task, initial, feedbackDays: days(19_000_000 + i * 100), finalDays: days(19_000_004 + i * 100) };
  });
  const bytes = cases.map(row => JSON.stringify(row)).join("\n") + "\n";
  writeFileSync(join(data, "test-factories.jsonl"), bytes);
  const files = { "train.jsonl": { sha256: "a".repeat(64), bytes: 1 }, "validation.jsonl": { sha256: "b".repeat(64), bytes: 1 }, "test-factories.jsonl": { sha256: contentHash(bytes), bytes: Buffer.byteLength(bytes) } };
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ schemaVersion: 1, taskProfile: "optimizer", promptProfile: OPTIMIZER_PROMPT_PROFILE, graderHash: graderHash(), files, sourceHashes: { "src/training/optimizer.ts": contentHash(readFileSync("src/training/optimizer.ts", "utf8")) }, splitBuildingHashes: { train: [], validation: [], test: cases.map(row => row.buildingHash) } }));
  const provenance: OptimizerProvenance = {
    baseModel: "factory-optimizer-base", tunedModel: "factory-optimizer-lora", baseCheckpoint: `test/nemotron@${"a".repeat(40)}`, tunedBaseCheckpoint: `test/nemotron@${"a".repeat(40)}`, trainingJobId: "optimizer-toy-test",
    taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", dataset: { graderHash: graderHash(), files: { "train.jsonl": files["train.jsonl"].sha256, "validation.jsonl": files["validation.jsonl"].sha256 } }, adapterHashes: { "adapter_config.json": "c".repeat(64), "adapter_model.safetensors": "d".repeat(64) },
  };
  const options: OptimizerEvaluationOptions = { dataDirectory: data, outputDirectory: join(directory, "output"), baseModel: provenance.baseModel, tunedModel: provenance.tunedModel, baseUrl: "http://127.0.0.1:1/v1", provenance, live: true, finalEval: true, factoryLimit: count, proposalsPerFactory: 3, maxModelCalls: count * 6, maxTokensPerArm: 100_000, maxSimulationsPerArm: count * 24, maxOutputTokens: 128, randomSeed: 12345, ...override };
  const ready = (plan: OptimizerEvaluationPlan) => {
    writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ planHash: contentHash(plan), health: { status: "ready", ...provenance } }));
  };
  return { options, directory, data, cases, ready, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };

test("optimizer evaluation seals the plan and checks task/profile/checkpoint before test access", () => {
  const f = fixture();
  try {
    assert.throws(() => freezeOptimizerEvaluation({ ...f.options, finalEval: false }), /--final-eval/);
    assert.throws(() => freezeOptimizerEvaluation({ ...f.options, provenance: { ...f.options.provenance!, taskProfile: "critic" as "optimizer" } }), /optimizer adapter/);
    assert.throws(() => freezeOptimizerEvaluation({ ...f.options, provenance: { ...f.options.provenance!, dataset: { ...f.options.provenance!.dataset, files: { "train.jsonl": "f".repeat(64), "validation.jsonl": "b".repeat(64) } } } }), /not trained on this/);
    const plan = freezeOptimizerEvaluation(f.options);
    assert.throws(() => readOptimizerCases(plan), /ENOENT/);
    f.ready(plan);
    const cases = readOptimizerCases(plan);
    assert.equal(cases.length, 1);
    assert.throws(() => readOptimizerCases({ ...plan, randomSeed: 9000 }), /plan changed/);
    const health = { status: "ready", ...f.options.provenance! };
    assert.throws(() => validateOptimizerHealth({ ...health, taskProfile: "critic" }, f.options.provenance), /health does not match/);
    assert.throws(() => validateOptimizerHealth({ ...health, trainingJobId: "wrong" }, f.options.provenance), /health does not match/);
  } finally { f.cleanup(); }
});

test("equal action opportunities retain only measured improvements; final demand stays hidden until search ends", async () => {
  const f = fixture();
  try {
    const item = f.cases[0], initial = measureLayout(item.task, item.initial, item.feedbackDays);
    const action = legalMoveActions(item.task, item.initial, 73, 96).find(candidate => betterCandidate(initial, measureLayout(item.task, applyAction(item.task, item.initial, candidate), item.feedbackDays)));
    assert.ok(action, "toy factory must have an independently measured improving move");
    const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
    const cases = readOptimizerCases(plan);
    const requests: Parameters<Parameters<typeof runOptimizerEvaluation>[2]>[0][] = [];
    const times: string[] = [];
    const counts = { base: 0, tuned: 0 };
    const report = await runOptimizerEvaluation(plan, cases, async request => {
      requests.push(request); times.push("model");
      const base = request.model === f.options.baseModel;
      if (base) counts.base++; else counts.tuned++;
      for (const day of item.finalDays) assert.ok(!JSON.stringify(request.messages).includes(String(day.seed)));
      assert.equal(request.maxOutputTokens, 128); assert.equal(request.temperature, 0);
      return { content: base ? '{"op":"move","stationId":"recv-1","x":0,"y":0}' : counts.tuned === 1 ? JSON.stringify(action) : '{"op":"stop"}', usage };
    }, (task, layout, days) => {
      times.push(days[0].seed === item.finalDays[0].seed ? "final" : "feedback");
      return measureLayout(task, layout, days);
    });
    assert.equal(report.completed, true); assert.equal(report.pairedCases, 1);
    assert.deepEqual(requests[0].messages, requests[1].messages);
    assert.equal(report.overall.base.budget.offeredProposals, 3); assert.equal(report.overall.tuned.budget.offeredProposals, 3);
    assert.equal(report.overall.base.budget.invalidActions, 3); assert.equal(report.overall.tuned.budget.acceptedMoves, 1);
    assert.equal(report.overall.base.budget.modelCalls, 3); assert.equal(report.overall.tuned.budget.modelCalls, 2);
    assert.equal(report.overall.tuned.budget.skippedProposals, 1);
    assert.equal(report.overall.random.budget.modelCalls, 0); assert.equal(report.overall.random.budget.attemptedProposals, 3);
    assert.ok(times.lastIndexOf("model") < times.indexOf("final"));
    assert.equal(times.filter(value => value === "final").length, 6, "initial and champion each scored once for three arms");
    const expected = measureLayout(item.task, applyAction(item.task, item.initial, action), item.finalDays);
    assert.equal(report.overall.tuned.meanFinalObjective, expected.objective);
    assert.equal(report.overall.tuned.finalGoalPasses, Number(expected.goalMet));
    assert.ok(report.overall.tuned.budget.simulations <= f.options.maxSimulationsPerArm);
    await assert.rejects(() => runOptimizerEvaluation(plan, cases, async () => { throw new Error("must not dispatch"); }), /already attempted/);
  } finally { f.cleanup(); }
});

test("identical stop outputs produce tied factory outcomes rather than artificial schema wins", async () => {
  const f = fixture();
  try {
    const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
    const report = await runOptimizerEvaluation(plan, readOptimizerCases(plan), async () => ({ content: '{"op":"stop"}', usage }));
    assert.deepEqual(report.pairedWins, { base: 0, tuned: 0, ties: 1 });
    assert.equal(report.overall.base.meanObjectiveDelta, 0); assert.equal(report.overall.tuned.meanObjectiveDelta, 0);
    assert.equal(report.overall.base.budget.modelCalls, 1); assert.equal(report.overall.tuned.budget.modelCalls, 1);
  } finally { f.cleanup(); }
});

test("failed calls retain unknown token reservations and every factory in denominators without retry", async () => {
  const f = fixture({}, 2);
  try {
    const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
    let calls = 0;
    const report = await runOptimizerEvaluation(plan, readOptimizerCases(plan), async () => { calls++; throw Object.assign(new Error("SECRET-SHOULD-NOT-APPEAR"), { status: 503 }); });
    assert.equal(calls, 1); assert.equal(report.completed, false); assert.equal(report.pairedCases, 0); assert.equal(report.incompletePairs, 2);
    assert.ok(report.overall.base.budget.reservedUnknownTokens > 0);
    for (const arm of ["base", "tuned", "random"] as const) { assert.equal(report.overall[arm].factories, 2); assert.equal(report.overall[arm].scoredFactories, 2); }
    const journal = readFileSync(join(plan.outputDirectory, "receipts.jsonl"), "utf8");
    assert.ok(!journal.includes("SECRET-SHOULD-NOT-APPEAR")); assert.ok(journal.includes('"status":503'));
  } finally { f.cleanup(); }
});

test("full-prompt reservation stops before dispatch and missing usage never refunds a call", async () => {
  for (const maxTokensPerArm of [1, 100_000]) {
    const f = fixture({ maxTokensPerArm });
    try {
      const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
      let calls = 0;
      const report = await runOptimizerEvaluation(plan, readOptimizerCases(plan), async () => { calls++; return { content: '{"op":"stop"}' }; });
      assert.equal(calls, maxTokensPerArm === 1 ? 0 : 1);
      assert.equal(report.stopped, maxTokensPerArm === 1 ? "model_budget_exhausted_before_dispatch" : "missing_or_invalid_usage_charge_unknown");
      assert.equal(report.overall.base.factories, 1);
      if (calls) assert.ok(report.overall.base.budget.reservedUnknownTokens > 0);
    } finally { f.cleanup(); }
  }
});

test("frozen factory bytes and feedback/final independence cannot be silently changed", () => {
  const f = fixture();
  try {
    const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
    writeFileSync(join(f.data, "test-factories.jsonl"), "{}\n");
    assert.throws(() => readOptimizerCases(plan), /frozen hash/);
  } finally { f.cleanup(); }
});


test("correctly hashed test data still rejects duplicate and previously trained demand seeds", () => {
  for (const overlap of ["within-final", "feedback-final", "training-final"] as const) {
    const f = fixture();
    try {
      const manifest = JSON.parse(readFileSync(join(f.data, "manifest.json"), "utf8"));
      if (overlap === "within-final") f.cases[0].finalDays[1].seed = f.cases[0].finalDays[0].seed;
      if (overlap === "feedback-final") f.cases[0].finalDays[0].seed = f.cases[0].feedbackDays[0].seed;
      if (overlap === "training-final") manifest.splitDemandSeeds = { train: [f.cases[0].finalDays[0].seed], validation: [] };
      const bytes = f.cases.map(row => JSON.stringify(row)).join("\n") + "\n";
      manifest.files["test-factories.jsonl"] = { sha256: contentHash(bytes), bytes: Buffer.byteLength(bytes) };
      writeFileSync(join(f.data, "test-factories.jsonl"), bytes);
      writeFileSync(join(f.data, "manifest.json"), JSON.stringify(manifest));
      const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
      assert.throws(() => readOptimizerCases(plan), /four fresh/);
    } finally { f.cleanup(); }
  }
});


test("a rejected proposal changes the next prompt with measured feedback equally for both arms", async () => {
  const f = fixture();
  try {
    const item = f.cases[0], before = measureLayout(item.task, item.initial, item.feedbackDays);
    const candidates = legalMoveActions(item.task, item.initial, 93, 96).map(action => ({ action, measured: measureLayout(item.task, applyAction(item.task, item.initial, action), item.feedbackDays) }));
    const rejected = candidates.find(candidate => !betterCandidate(before, candidate.measured));
    const accepted = candidates.find(candidate => betterCandidate(before, candidate.measured));
    assert.ok(rejected); assert.ok(accepted);
    const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
    const requests: Record<string, Parameters<Parameters<typeof runOptimizerEvaluation>[2]>[0][]> = { [plan.baseModel]: [], [plan.tunedModel]: [] };
    const report = await runOptimizerEvaluation(plan, readOptimizerCases(plan), async request => {
      const previous = requests[request.model]; previous.push(request);
      const index = previous.length - 1;
      for (const day of item.finalDays) assert.ok(!JSON.stringify(request.messages).includes(String(day.seed)));
      if (index === 1) {
        const prompt = JSON.parse(request.messages[1].content);
        assert.equal(prompt.previousAttempts.length, 1);
        assert.equal(prompt.previousAttempts[0].status, "rejected");
        assert.deepEqual(prompt.previousAttempts[0].action, rejected.action);
        assert.equal(prompt.previousAttempts[0].feedback.metrics.objective, Math.round(rejected.measured.objective! * 100) / 100);
        assert.notDeepEqual(request.messages, previous[0].messages);
      }
      return { content: JSON.stringify(index === 0 ? rejected.action : index === 1 ? accepted.action : { op: "stop" }), usage };
    });
    assert.equal(report.completed, true);
    for (let i = 0; i < 3; i++) assert.deepEqual(requests[plan.baseModel][i].messages, requests[plan.tunedModel][i].messages);
    assert.equal(report.overall.base.budget.modelCalls, 3); assert.equal(report.overall.tuned.budget.modelCalls, 3);
    assert.equal(report.overall.base.budget.acceptedMoves, 1); assert.equal(report.overall.tuned.budget.acceptedMoves, 1);
    assert.equal(report.overall.base.budget.simulations, report.overall.tuned.budget.simulations);
    assert.equal(report.overall.base.budget.knownTokens, report.overall.tuned.budget.knownTokens);
  } finally { f.cleanup(); }
});


test("malformed responses consume one opportunity and return bounded diagnostic history to both arms", async () => {
  const f = fixture();
  try {
    const plan = freezeOptimizerEvaluation(f.options); f.ready(plan);
    const requests: Record<string, Parameters<Parameters<typeof runOptimizerEvaluation>[2]>[0][]> = { [plan.baseModel]: [], [plan.tunedModel]: [] };
    const raw = "not-json".repeat(100);
    const report = await runOptimizerEvaluation(plan, readOptimizerCases(plan), async request => {
      const previous = requests[request.model]; previous.push(request);
      return { content: previous.length === 1 ? raw : '{"op":"stop"}', usage };
    });
    assert.equal(report.completed, true);
    for (const arm of ["base", "tuned"] as const) {
      const model = arm === "base" ? plan.baseModel : plan.tunedModel;
      const history = JSON.parse(requests[model][1].messages[1].content).previousAttempts;
      assert.equal(history[0].status, "invalid"); assert.equal(history[0].rawText, raw.slice(0, 512));
      assert.match(history[0].reason, /bare JSON/);
      assert.notDeepEqual(requests[model][0].messages, requests[model][1].messages);
      assert.equal(report.overall[arm].budget.modelCalls, 2); assert.equal(report.overall[arm].budget.invalidActions, 1);
    }
    assert.deepEqual(requests[plan.baseModel][1].messages, requests[plan.tunedModel][1].messages);
  } finally { f.cleanup(); }
});
