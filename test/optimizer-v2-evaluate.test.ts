import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { graderHash } from "../src/sim/version.ts";
import type { DemandDay } from "../src/training/critic.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "../src/training/generate.ts";
import { legalMoveActions, type OptimizerCase } from "../src/training/optimizer-data.ts";
import { applyAction, betterCandidate, measureLayout, OPTIMIZER_PROMPT_PROFILE } from "../src/training/optimizer.ts";
import { freezeV2Evaluation, readV2Cases, runV2Evaluation, validateV2Health, V2_MODELS, V2_BASE_CHECKPOINT, V1_DATASET, type V2Health, type V2Options, type V2Dependencies } from "../src/training/optimizer-v2-evaluate.ts";
function fixture(overrides: Partial<V2Options> = {}) {
  const root = resolve("runs/optimizer-eval"); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, ".v2-test-")), data = join(directory, "data"); mkdirSync(data);
  const task = generateBuilding(78167222, "toy-v2");
  const days = (seed: number): DemandDay[] => (["normal", "peak", "fragile", "skewed"] as const).map((profile, i) => ({ seed: seed + i, profile, count: 100 }));
  const row: OptimizerCase = { id: task.id, split: "test", buildingId: task.id, buildingHash: buildingHash(task), geometrySeed: 78167222, initialLayoutHash: layoutHash(task.initial), task, initial: task.initial, feedbackDays: days(78390001), finalDays: days(78390005) };
  const bytes = JSON.stringify(row) + "\n";
  writeFileSync(join(data, "test-factories.jsonl"), bytes);
  const files = { "train.jsonl": { sha256: "a".repeat(64), bytes: 1 }, "validation.jsonl": { sha256: "b".repeat(64), bytes: 1 }, "test-factories.jsonl": { sha256: contentHash(bytes), bytes: Buffer.byteLength(bytes) } };
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ schemaVersion: 1, taskProfile: "optimizer", promptProfile: OPTIMIZER_PROMPT_PROFILE, graderHash: graderHash(), files, sourceHashes: { "src/training/optimizer.ts": contentHash(readFileSync("src/training/optimizer.ts", "utf8")) }, splitBuildingHashes: { train: [], validation: [], test: [row.buildingHash] }, splitDemandSeeds: { train: [], validation: [] } }));
  const baseCheckpoint = V2_BASE_CHECKPOINT;
  const health: V2Health = { schemaVersion: 2, status: "ready", baseCheckpoint, taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", models: Object.fromEntries(V2_MODELS.map((alias, i) => [alias, { baseCheckpoint, trainingJobId: i ? `job-${i}` : null, epochs: [0, 1, 3, 1][i], taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", dataset: i ? { graderHash: graderHash(), files: { "train.jsonl": i === 3 ? "a".repeat(64) : V1_DATASET.files["train.jsonl"], "validation.jsonl": i === 3 ? "b".repeat(64) : V1_DATASET.files["validation.jsonl"] } } : null, adapterHashes: i ? { "adapter_config.json": "e".repeat(64), "adapter_model.safetensors": String(i).repeat(64) } : null }])) as V2Health["models"] };
  const options: V2Options = { dataDirectory: data, outputDirectory: join(directory, "output"), baseUrl: "http://127.0.0.1:1/v1", provenance: health, live: true, finalEval: true, factoryLimit: 1, maxModelCalls: 48, maxTokensPerArm: 300_000, maxSimulationsPerArm: 64, maxRuntimeMs: 120_000, randomSeed: 8817, ...overrides };
  const prepare = () => { const plan = freezeV2Evaluation(options); writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ planHash: contentHash(plan), health })); return { plan, cases: readV2Cases(plan) }; };
  return { directory, data, options, row, health, prepare, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };
const noTeacher: NonNullable<V2Dependencies["teacher"]> = (() => ({ actions: [], endpoint: { feasible: false }, simulatorCalls: 0 })) as any;

test("v2 freezes four distinct same-base arms and validates health before held-out access", () => {
  const f = fixture();
  try {
    assert.throws(() => freezeV2Evaluation({ ...f.options, finalEval: false }), /--final-eval/);
    const wrong = structuredClone(f.health); wrong.models["factory-optimizer-old3"].epochs = 1;
    assert.throws(() => validateV2Health(wrong, wrong), /epoch arm/);
    const wrongData = structuredClone(f.health); wrongData.models["factory-optimizer-old3"].dataset!.files["train.jsonl"] = "f".repeat(64);
    assert.throws(() => validateV2Health(wrongData, wrongData), /original v1 dataset/);
    const plan = freezeV2Evaluation(f.options);
    assert.throws(() => readV2Cases(plan), /ENOENT/);
    assert.throws(() => validateV2Health({ ...f.health, status: "loading" }, f.health), /health/);
  } finally { f.cleanup(); }
});

test("all four arms receive twelve equal opportunities and final scoring waits for all searches", async () => {
  const f = fixture();
  try {
    const { plan, cases } = f.prepare();
    const requests: Parameters<Parameters<typeof runV2Evaluation>[2]>[0][] = [];
    let finalStartedAt: number | undefined;
    const report = await runV2Evaluation(plan, cases, async request => {
      requests.push(request);
      for (const day of f.row.finalDays) assert.ok(!JSON.stringify(request.messages).includes(String(day.seed)));
      assert.equal(request.maxOutputTokens, 128); assert.equal(request.temperature, 0);
      return { content: "malformed", usage };
    }, { teacher: noTeacher, measure: (task, layout, days) => { if (days[0].seed === f.row.finalDays[0].seed) finalStartedAt ??= requests.length; return measureLayout(task, layout, days); } });
    assert.equal(report.completed, true); assert.equal(requests.length, 48); assert.equal(finalStartedAt, 48);
    for (const alias of V2_MODELS) {
      assert.equal(report.overall[alias].modelCalls, 12); assert.equal(report.overall[alias].invalidActions, 12);
      assert.equal(report.overall[alias].snapshots.round3.meanObjectiveDelta, 0); assert.equal(report.overall[alias].snapshots.round12.meanObjectiveDelta, 0);
      assert.equal(report.overall[alias].knownTokens, 1440);
    }
    for (let round = 0; round < 12; round++) {
      const group = requests.slice(round * 4, round * 4 + 4);
      assert.equal(group[0].model, V2_MODELS[round % 4]);
      for (const r of group.slice(1)) assert.deepEqual(r.messages, group[0].messages);
    }
    assert.equal(report.overall.random.modelCalls, 0); assert.equal(report.overall["geometric-teacher"].modelCalls, 0);
  } finally { f.cleanup(); }
});

test("resolved model responses resume after local interruption without duplicate inference", async () => {
  const f = fixture();
  try {
    const { plan, cases } = f.prepare(); let calls = 0, durable = 0;
    const responder = async () => { calls++; return { content: '{"op":"stop"}', usage }; };
    await assert.rejects(() => runV2Evaluation(plan, cases, responder, { teacher: noTeacher, afterReceipt: () => { if (++durable === 2) throw new Error("simulated process interruption"); } }), /process interruption/);
    assert.equal(calls, 2); assert.ok(existsSync(join(plan.outputDirectory, "checkpoint.json"))); assert.ok(!existsSync(join(plan.outputDirectory, "metrics.json")));
    const report = await runV2Evaluation(plan, cases, responder, { teacher: noTeacher });
    assert.equal(report.completed, true); assert.equal(calls, 4, "each alias should be called once despite restart");
    for (const alias of V2_MODELS) assert.equal(report.overall[alias].modelCalls, 1);
  } finally { f.cleanup(); }
});

test("unresolved pending calls prevent any retry and keep unknown charges visible", async () => {
  const f = fixture();
  try {
    const { plan, cases } = f.prepare(); let calls = 0;
    const responder = async () => { calls++; return { content: '{"op":"stop"}', usage }; };
    await assert.rejects(() => runV2Evaluation(plan, cases, responder, { teacher: noTeacher, afterReceipt: () => { throw new Error("power loss"); } }), /power loss/);
    const requestDir = join(plan.outputDirectory, "requests"), path = join(requestDir, readdirSync(requestDir).find(p => p.endsWith(".json"))!);
    const receipt = JSON.parse(readFileSync(path, "utf8")); receipt.status = "pending"; delete receipt.reply; writeFileSync(path, JSON.stringify(receipt));
    const report = await runV2Evaluation(plan, cases, responder, { teacher: noTeacher });
    assert.equal(calls, 1); assert.equal(report.completed, false); assert.equal(report.terminalReason, "unresolved_request_never_retried");
    assert.ok(report.overall[V2_MODELS[0]].reservedUnknownTokens > 0);
    assert.equal(report.overall[V2_MODELS[0]].snapshots.round12.factories, 1);
  } finally { f.cleanup(); }
});

test("token and runtime limits stop before new inference without dropping factories", async () => {
  for (const reason of ["token", "runtime"] as const) {
    const f = fixture(reason === "token" ? { maxTokensPerArm: 1 } : { maxRuntimeMs: 1 });
    try {
      const { plan, cases } = f.prepare(); let calls = 0, time = 0;
      const report = await runV2Evaluation(plan, cases, async () => { calls++; return { content: '{"op":"stop"}', usage }; }, { teacher: noTeacher, ...(reason === "runtime" ? { now: () => ++time } : {}) });
      assert.equal(calls, 0); assert.equal(report.completed, false);
      assert.equal(report.terminalReason, reason === "token" ? "token_or_call_cap_exhausted" : "runtime_cap_exhausted");
      for (const alias of V2_MODELS) assert.equal(report.overall[alias].snapshots.round12.factories, 1);
    } finally { f.cleanup(); }
  }
});

test("a provider failure is redacted, never retried, and preserves collected output", async () => {
  const f = fixture();
  try {
    const { plan, cases } = f.prepare(); let calls = 0;
    const report = await runV2Evaluation(plan, cases, async () => { if (++calls === 2) throw new Error("SECRET"); return { content: '{"op":"stop"}', usage }; }, { teacher: noTeacher });
    assert.equal(calls, 2); assert.equal(report.completed, false);
    assert.equal(report.overall[V2_MODELS[0]].knownTokens, 120);
    assert.ok(report.overall[V2_MODELS[1]].reservedUnknownTokens > 0);
    const bytes = readdirSync(join(plan.outputDirectory, "requests")).map(p => readFileSync(join(plan.outputDirectory, "requests", p), "utf8")).join("");
    assert.ok(!bytes.includes("SECRET"));
    await runV2Evaluation(plan, cases, async () => { throw new Error("must not dispatch"); }, { teacher: noTeacher });
  } finally { f.cleanup(); }
});


test("the three-proposal snapshot stays frozen while later improvements change the twelve-proposal result", async () => {
  const f = fixture();
  try {
    const item = f.row, before = measureLayout(item.task, item.initial, item.feedbackDays);
    const first = legalMoveActions(item.task, item.initial, 3817, 96).find(action => betterCandidate(before, measureLayout(item.task, applyAction(item.task, item.initial, action), item.feedbackDays)));
    assert.ok(first);
    const afterFirst = applyAction(item.task, item.initial, first), firstScore = measureLayout(item.task, afterFirst, item.feedbackDays);
    const second = legalMoveActions(item.task, afterFirst, 9321, 96).find(action => betterCandidate(firstScore, measureLayout(item.task, applyAction(item.task, afterFirst, action), item.feedbackDays)));
    assert.ok(second);
    const afterSecond = applyAction(item.task, afterFirst, second), counts = new Map<string, number>();
    const { plan, cases } = f.prepare();
    const report = await runV2Evaluation(plan, cases, async request => {
      const round = counts.get(request.model) ?? 0; counts.set(request.model, round + 1);
      return { content: round === 0 ? JSON.stringify(first) : round === 3 ? JSON.stringify(second) : round >= 4 ? '{"op":"stop"}' : "malformed", usage };
    }, { teacher: noTeacher });
    assert.equal(report.completed, true);
    for (const alias of V2_MODELS) {
      const state = report.cases.find((s: any) => s.arm === alias);
      assert.equal(layoutHash(state.snapshot3), layoutHash(afterFirst));
      assert.equal(layoutHash(state.layout), layoutHash(afterSecond));
      assert.equal(report.overall[alias].snapshots.round3.meanObjective, measureLayout(item.task, afterFirst, item.finalDays).objective);
      assert.equal(report.overall[alias].snapshots.round12.meanObjective, measureLayout(item.task, afterSecond, item.finalDays).objective);
    }
  } finally { f.cleanup(); }
});
