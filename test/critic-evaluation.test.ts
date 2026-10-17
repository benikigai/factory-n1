import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chatExample, generateDataset } from "../src/training/dataset.ts";
import { contentHash } from "../src/training/generate.ts";
import { armMetrics, comparePredictions, freezeEvaluation, parsePrediction, readEvaluationCases, runEvaluation, validateLoopbackHealth, type EvaluationOptions, type Prediction } from "../src/training/evaluate.ts";

function fixture(live = false, override: Partial<EvaluationOptions> = {}) {
  const root = resolve("runs/finetune-eval"); mkdirSync(root, { recursive: true });
  const base = mkdtempSync(join(root, ".test-")), data = join(base, "data"); mkdirSync(data);
  // Generated in memory; these tests never open the real critic-v1 test split.
  const rows = generateDataset({ seed: 20261019, buildings: { train: 1, validation: 2, test: 1 }, examplesPerBuilding: 5 });
  const validation = rows.filter(row => row.split === "validation").map(row => JSON.stringify(chatExample(row))).join("\n") + "\n";
  writeFileSync(join(data, "validation.jsonl"), validation);
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ schemaVersion: 1, graderHash: "frozen-grader", files: { "validation.jsonl": { sha256: contentHash(validation), bytes: Buffer.byteLength(validation) }, "test.jsonl": { sha256: "a".repeat(64), bytes: 1 } } }));
  const options: EvaluationOptions = {
    dataDirectory: data, outputDirectory: join(base, "output"), split: "validation", finalEval: false, live,
    baseModel: "base-immutable-id", tunedModel: "adapter-id", baseUrl: "https://example.invalid/v1",
    provenance: { baseModel: "base-immutable-id", tunedModel: "adapter-id", baseCheckpoint: `weights-sha256:${"a".repeat(64)}`, tunedBaseCheckpoint: `weights-sha256:${"a".repeat(64)}`, trainingJobId: "job-123" },
    limit: 4, maxCalls: 8, maxTotalTokens: 200_000, maxOutputTokens: 512,
    ...override,
  };
  return { base, data, options, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("preflight freezes before reading data and prevents unapproved test access", () => {
  const f = fixture();
  try {
    assert.throws(() => freezeEvaluation({ ...f.options, split: "test" }), /--final-eval/);
    const plan = freezeEvaluation(f.options);
    assert.ok(readFileSync(join(plan.outputDirectory, "evaluation-plan.json"), "utf8").includes(plan.datasetHash));
    const cases = readEvaluationCases(plan);
    assert.equal(cases.length, 4);
    assert.equal(new Set(cases.map(item => item.building)).size, 2);
    assert.throws(() => readEvaluationCases({ ...plan, maxCalls: 100 }), /plan changed/);
  } finally { f.cleanup(); }
});

test("strict output validation enforces numeric fields and invalid-layout nulls", () => {
  const invalid = { valid: false, errors: ["bad layout"], metrics: null, zeroDamage: null, allShipped: null, goalMet: null };
  assert.deepEqual(parsePrediction(JSON.stringify(invalid)), invalid);
  assert.equal(parsePrediction(JSON.stringify({ ...invalid, goalMet: true })), null);
  assert.equal(parsePrediction("```json\n{}\n```"), null);
  assert.equal(parsePrediction(JSON.stringify({ ...invalid, surprise: true })), null);
  const valid = { valid: true, errors: [], metrics: { objective: 1, makespan: 1, damaged: 0, missorts: 0, unshipped: 0 }, zeroDamage: true, allShipped: true, goalMet: true };
  assert.ok(parsePrediction(JSON.stringify(valid)));
  assert.equal(parsePrediction(JSON.stringify({ ...valid, metrics: { ...valid.metrics, damaged: -1 } })), null);
});

test("metrics count nulls, missing numeric predictions, false-safe cases and paired wins", () => {
  const f = fixture();
  try {
    const cases = readEvaluationCases(freezeEvaluation(f.options));
    const first = cases[0];
    const bad = { ...first.expected, zeroDamage: !first.expected.zeroDamage, goalMet: !first.expected.goalMet };
    const predictions: Prediction[] = [
      { caseId: first.id, building: first.building, arm: "base", model: "base", parsed: bad },
      { caseId: first.id, building: first.building, arm: "tuned", model: "tuned", parsed: first.expected },
    ];
    const report = comparePredictions([first], predictions);
    assert.equal(report.pairedWins.categorical.tunedWins, 1);
    assert.equal(report.overall.tuned.validityAccuracy.rate, 1);
    const missing = armMetrics([first], []);
    assert.equal(missing.schemaValidity.rate, 0);
    assert.equal(missing.numeric.objective.missing, first.expected.valid ? 1 : 0);
    const invalidCase = { ...first, expected: { valid: false, errors: ["invalid"], metrics: null, zeroDamage: null, allShipped: null, goalMet: null } };
    const unsafe = { ...first.expected, valid: true, errors: [], zeroDamage: true, allShipped: true, goalMet: true };
    const falseSafe = armMetrics([invalidCase], [{ ...predictions[0], parsed: unsafe }]);
    assert.equal(falseSafe.falseSafe.goalMet.falseSafe, 1);
    assert.equal(falseSafe.flagAccuracy.goalMet.rate, 0);
  } finally { f.cleanup(); }
});

test("paired calls use identical prompts and settings, then refuse replay", async () => {
  const f = fixture(true);
  try {
    const plan = freezeEvaluation(f.options), cases = readEvaluationCases(plan);
    const requests: unknown[] = [];
    const report = await runEvaluation(plan, cases, async request => {
      requests.push(request);
      const item = cases[Math.floor((requests.length - 1) / 2)];
      return { content: JSON.stringify(item.expected), usage: { promptTokens: 20, completionTokens: 20, totalTokens: 40 } };
    });
    assert.equal(report.completed, true);
    assert.equal(report.pairedCases, 4);
    assert.equal(report.budget.attempts, 8);
    for (let i = 0; i < requests.length; i += 2) {
      const a = requests[i] as Record<string, unknown>, b = requests[i + 1] as Record<string, unknown>;
      assert.deepEqual({ ...a, model: null }, { ...b, model: null });
    }
    await assert.rejects(() => runEvaluation(plan, cases, async () => { throw new Error("must not call"); }), /already attempted/);
  } finally { f.cleanup(); }
});

test("ambiguous failures retain reservations, redact errors, and stop without retry", async () => {
  const f = fixture(true);
  try {
    const plan = freezeEvaluation(f.options), cases = readEvaluationCases(plan);
    let calls = 0;
    const report = await runEvaluation(plan, cases, async () => { calls++; throw Object.assign(new Error("SECRET-KEY-MUST-NOT-APPEAR"), { status: 429 }); });
    assert.equal(calls, 1);
    assert.equal(report.completed, false);
    assert.ok(report.budget.reservedUnknownTokens > 0);
    const journal = readFileSync(join(plan.outputDirectory, "responses.jsonl"), "utf8");
    assert.ok(!journal.includes("SECRET-KEY"));
    assert.ok(journal.includes('"status":429'));
  } finally { f.cleanup(); }
});

test("caps stop before dispatch and missing usage never silently refunds budget", async () => {
  for (const cap of [1, 200_000]) {
    const f = fixture(true, { maxTotalTokens: cap });
    try {
      const plan = freezeEvaluation(f.options), cases = readEvaluationCases(plan);
      let calls = 0;
      const report = await runEvaluation(plan, cases, async () => { calls++; return { content: JSON.stringify(cases[0].expected) }; });
      assert.equal(calls, cap === 1 ? 0 : 1);
      assert.equal(report.stopped, cap === 1 ? "budget_exhausted_before_dispatch" : "missing_or_invalid_usage_charge_unknown");
    } finally { f.cleanup(); }
  }
});

test("live mode requires immutable matching provenance and distinct model IDs", () => {
  const f = fixture(true);
  try {
    assert.throws(() => freezeEvaluation({ ...f.options, tunedModel: f.options.baseModel }), /distinct/);
    assert.throws(() => freezeEvaluation({ ...f.options, provenance: undefined }), /provenance/);
    assert.throws(() => freezeEvaluation({ ...f.options, provenance: { ...f.options.provenance!, baseCheckpoint: "main", tunedBaseCheckpoint: "main" } }), /immutable/);
    assert.throws(() => freezeEvaluation({ ...f.options, provenance: { ...f.options.provenance!, tunedBaseCheckpoint: "different" } }), /checkpoint/);
  } finally { f.cleanup(); }
});

test("loopback health requires ready status and the exact frozen checkpoint and training job", () => {
  const proof = { baseModel: "base", tunedModel: "tuned", baseCheckpoint: `repo@${"a".repeat(40)}`, tunedBaseCheckpoint: `repo@${"a".repeat(40)}`, trainingJobId: "training-123" };
  const health = { status: "ready", baseCheckpoint: proof.baseCheckpoint, trainingJobId: proof.trainingJobId };
  assert.deepEqual(validateLoopbackHealth(health, proof), health);
  assert.throws(() => validateLoopbackHealth({ ...health, status: "loading" }, proof), /health does not match/);
  assert.throws(() => validateLoopbackHealth({ ...health, baseCheckpoint: `repo@${"b".repeat(40)}` }, proof), /health does not match/);
  assert.throws(() => validateLoopbackHealth({ ...health, trainingJobId: "other-job" }, proof), /health does not match/);
  assert.throws(() => validateLoopbackHealth(health, undefined), /health does not match/);
});
