import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { graderHash } from "../src/sim/version.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "../src/training/generate.ts";
import { type OptimizerCase } from "../src/training/optimizer-data.ts";
import { measureLayout, OPTIMIZER_PROMPT_PROFILE } from "../src/training/optimizer.ts";
import { freezeV2Evaluation, readV2Cases, runV2Evaluation, V2_MODELS, V2_BASE_CHECKPOINT, V1_DATASET, type V2Health } from "../src/training/optimizer-v2-evaluate.ts";
import { EXCLUDED_CASE, UNKNOWN_REQUEST, prepareV2Continuation, runV2Continuation } from "../src/training/optimizer-v2-continuation.ts";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
function fixture() {
  const parent = resolve("runs/optimizer-eval"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, ".continuation-test-")), data = join(directory, "data"); mkdirSync(data);
  const rows: OptimizerCase[] = [1, 11, 12].map((n, i) => {
    const id = `optimizer-v2-test-building-${n}`, seed = 89167111 + i * 231, task = generateBuilding(seed, id);
    const days = (offset: number) => (["normal", "peak", "fragile", "skewed"] as const).map((profile, j) => ({ seed: 89290000 + i * 10 + offset + j, profile, count: 100 }));
    return { id, split: "test", buildingId: id, buildingHash: buildingHash(task), geometrySeed: seed, initialLayoutHash: layoutHash(task.initial), task, initial: task.initial, feedbackDays: days(0), finalDays: days(4) };
  });
  const bytes = rows.map(r => JSON.stringify(r)).join("\n") + "\n"; writeFileSync(join(data, "test-factories.jsonl"), bytes);
  const files = { "train.jsonl": { sha256: "a".repeat(64), bytes: 1 }, "validation.jsonl": { sha256: "b".repeat(64), bytes: 1 }, "test-factories.jsonl": { sha256: contentHash(bytes), bytes: Buffer.byteLength(bytes) } };
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ taskProfile: "optimizer", promptProfile: OPTIMIZER_PROMPT_PROFILE, graderHash: graderHash(), files, sourceHashes: { "src/training/optimizer.ts": contentHash(readFileSync("src/training/optimizer.ts", "utf8")) }, splitBuildingHashes: { train: [], validation: [] }, splitDemandSeeds: { train: [], validation: [] } }));
  const baseCheckpoint = V2_BASE_CHECKPOINT;
  const health: V2Health = { schemaVersion: 2, status: "ready", baseCheckpoint, taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", models: Object.fromEntries(V2_MODELS.map((alias, i) => [alias, { baseCheckpoint, trainingJobId: i ? `job-${i}` : null, epochs: [0, 1, 3, 1][i], taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", dataset: i ? { graderHash: graderHash(), files: { "train.jsonl": i === 3 ? "a".repeat(64) : V1_DATASET.files["train.jsonl"], "validation.jsonl": i === 3 ? "b".repeat(64) : V1_DATASET.files["validation.jsonl"] } } : null, adapterHashes: i ? { "adapter_config.json": "e".repeat(64), "adapter_model.safetensors": String(i).repeat(64) } : null }])) as V2Health["models"] };
  const plan = freezeV2Evaluation({ dataDirectory: data, outputDirectory: join(directory, "original"), baseUrl: "http://127.0.0.1:1/v1", provenance: health, live: true, finalEval: true, factoryLimit: 3, maxModelCalls: 144, maxTokensPerArm: 1_000_000, maxSimulationsPerArm: 192, maxRuntimeMs: 120_000, randomSeed: 8817 });
  writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ planHash: contentHash(plan), health }));
  return { directory, plan, health, rows, cases: readV2Cases(plan), out: join(directory, "continuation"), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };
const noTeacher: any = () => ({ actions: [], endpoint: { feasible: false }, feedbackSimulationCalls: 0, simulatorCalls: 0 });
async function abortOriginal(f: ReturnType<typeof fixture>, now?: () => number) {
  let calls = 0;
  const result = await runV2Evaluation(f.plan, f.cases, async () => {
    calls++;
    if (calls === 9) throw new Error("No route to host");
    return { content: calls === 5 ? "malformed" : '{"op":"stop"}', usage };
  }, { teacher: noTeacher, ...(now ? { now } : {}) });
  assert.equal(result.terminalReason, "provider_failure_charge_unknown");
  assert.equal(read(join(f.plan.outputDirectory, "requests", UNKNOWN_REQUEST + ".json")).status, "unknown");
}

test("continuation preserves original evidence, skips all interrupted arms, preserves case rotation and recomputes only included finals", async () => {
  const f = fixture();
  try {
    await abortOriginal(f);
    const originalCheckpoint = readFileSync(join(f.plan.outputDirectory, "checkpoint.json"), "utf8");
    assert.throws(() => prepareV2Continuation({ originalDirectory: f.plan.outputDirectory, outputDirectory: f.out, approveContinuation: false }), /approve-continuation/);
    const manifest = prepareV2Continuation({ originalDirectory: f.plan.outputDirectory, outputDirectory: f.out, approveContinuation: true });
    const checkpoint = read(join(f.out, "engine/checkpoint.json"));
    assert.equal(manifest.includedIds.length, 2);
    assert.equal(checkpoint.startedAt, read(join(f.plan.outputDirectory, "checkpoint.json")).startedAt);
    const untouched = checkpoint.states.filter((s: any) => s.caseId.endsWith("-12"));
    assert.ok(untouched.every((s: any) => !s.final && !s.snapshot3));
    assert.ok(checkpoint.states.filter((s: any) => s.caseId === EXCLUDED_CASE).every((s: any) => s.stopped && s.continuationExcluded && s.final));
    assert.ok(!readdirSync(join(f.out, "engine/requests")).includes(UNKNOWN_REQUEST + ".json"));
    const calls: string[] = [], finalStarts: number[] = [];
    const report = await runV2Continuation(f.out, true, f.health, async request => {
      calls.push(request.model);
      return { content: '{"op":"stop"}', usage };
    }, { teacher: noTeacher, measure: (task, layout, days) => {
      assert.notEqual(task.id, EXCLUDED_CASE, "excluded factory must receive no simulations");
      if (f.rows.some(r => r.finalDays[0].seed === days[0].seed)) finalStarts.push(calls.length);
      return measureLayout(task, layout, days);
    } });
    assert.equal(calls.length, 4); assert.equal(calls[0], "factory-optimizer-old3", "original third case index stays two");
    assert.ok(finalStarts.every(n => n === 4));
    assert.equal(report.completed, true); assert.equal(report.primaryFactoryCount, 2); assert.equal(report.all20Completed, false);
    assert.equal(report.accounting.combinedModelCalls, 13); assert.equal(report.accounting.originalUnknownRequests, 1);
    assert.equal(report.accounting.combined["factory-optimizer-v1"].unknownReservedTokens, manifest.abandonedBudget["factory-optimizer-v1"].unknownReservedTokens);
    assert.ok(report.all20.filter((s: any) => s.caseId === EXCLUDED_CASE).every((s: any) => s.primaryEligible === false));
    assert.equal(readFileSync(join(f.plan.outputDirectory, "checkpoint.json"), "utf8"), originalCheckpoint);
    assert.equal(report.overall["factory-optimizer-base"].snapshots.round12.factories, 2);
    assert.equal(read(join(f.out, "engine/metrics.json")).completed, false);
    assert.equal(read(join(f.out, "engine/metrics.json")).internalOnly, true);
    const resumed = await runV2Continuation(f.out, true, f.health, async () => { throw new Error("completed continuation must not dispatch"); });
    assert.equal(resumed.completed, true);
  } finally { f.cleanup(); }
});

test("continuation refuses expired clocks and a second unknown request", async () => {
  const f = fixture();
  try {
    await abortOriginal(f);
    const checkpoint = read(join(f.plan.outputDirectory, "checkpoint.json"));
    assert.throws(() => prepareV2Continuation({ originalDirectory: f.plan.outputDirectory, outputDirectory: f.out, approveContinuation: true, now: checkpoint.startedAt + f.plan.maxRuntimeMs }), /deadline/);
    const path = join(f.plan.outputDirectory, "requests", UNKNOWN_REQUEST + ".json"), extra = read(path);
    writeFileSync(join(f.plan.outputDirectory, "requests/extra.json"), JSON.stringify({ ...extra, id: "another-unknown" }));
    assert.throws(() => prepareV2Continuation({ originalDirectory: f.plan.outputDirectory, outputDirectory: f.out, approveContinuation: true }), /Only the documented/);
  } finally { f.cleanup(); }
});


test("approved interruption pause preserves active runtime and caps the absolute deadline", async () => {
  const f = fixture();
  try {
    // The historical approval cutoff must not make this test expire with wall time.
    await abortOriginal(f, () => Date.parse("2026-10-17T19:00:00.000Z"));
    const original = read(join(f.plan.outputDirectory, "checkpoint.json"));
    const now = original.startedAt + 60_000, activeElapsedMs = 10_000, hardDeadline = now + 100_000;
    const m = prepareV2Continuation({ originalDirectory: f.plan.outputDirectory, outputDirectory: f.out, approveContinuation: true, now, pauseAllowance: { activeElapsedMs, hardDeadline } });
    assert.equal(m.originalStartedAt, original.startedAt);
    assert.equal(m.pause.pausedMs, 50_000);
    assert.equal(m.effectiveDeadline, hardDeadline);
    assert.equal(m.engineStartedAt + f.plan.maxRuntimeMs, hardDeadline);
    assert.equal(m.pause.originalActiveElapsedMs, activeElapsedMs);
    assert.ok(m.effectiveDeadline - now + activeElapsedMs <= f.plan.maxRuntimeMs);
    assert.equal(read(join(f.plan.outputDirectory, "checkpoint.json")).startedAt, original.startedAt);
  } finally { f.cleanup(); }
});
