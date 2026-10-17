import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeCallGuard } from "../src/agents/call-guard.ts";
import { CallBudget } from "../src/llm/budget.ts";
import { bindManifest, manifestHash, readCheckpoint, readCompletedPairs, saveCheckpoint } from "../src/loop/checkpoint.ts";
import { meterState, meteredEvaluate, restoreMeter, setSimCap, simUsed } from "../src/loop/meter.ts";
import { loadTaskA } from "../src/tasks/task.ts";

test("checkpoint binds every manifest field and preserves committed journals on a mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-checkpoint-"));
  try {
    const manifest = { task: { id: "a" }, options: { gens: 3 }, gitCommit: "abc", graderHash: "123" };
    const hash = bindManifest(dir, manifest);
    assert.equal(hash, manifestHash({ options: { gens: 3 }, graderHash: "123", task: { id: "a" }, gitCommit: "abc" }));
    writeFileSync(join(dir, "events.jsonl"), '{"committed":true}\n');
    saveCheckpoint(dir, hash, { generation: 1, seen: ["a"] });
    const checkpoint = readFileSync(join(dir, "checkpoint.json"), "utf8");
    appendFileSync(join(dir, "events.jsonl"), '{"partial":true}\n');
    for (const changed of [
      { ...manifest, task: { id: "b" } }, { ...manifest, options: { gens: 4 } },
      { ...manifest, gitCommit: "def" }, { ...manifest, graderHash: "456" },
    ]) assert.throws(() => bindManifest(dir, changed), /manifest mismatch/);
    assert.match(readFileSync(join(dir, "events.jsonl"), "utf8"), /partial/);
    assert.equal(readFileSync(join(dir, "checkpoint.json"), "utf8"), checkpoint);
    const restored = readCheckpoint<{ generation: number; seen: string[] }>(dir, hash);
    assert.deepEqual(restored?.state, { generation: 1, seen: ["a"] });
    assert.equal(readFileSync(join(dir, "events.jsonl"), "utf8"), '{"committed":true}\n');
    writeFileSync(join(dir, "events.jsonl"), '{"tampered!":true}\n');
    assert.throws(() => readCheckpoint(dir, hash), /journal changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an existing unbound solver artifact refuses the run ID without altering its bytes", () => {
  for (const artifact of ["replay.json", "champion.json", "memory.json", "research.json", "runtime.json", "spend.json"]) {
    const dir = mkdtempSync(join(tmpdir(), "factory-unbound-run-"));
    try {
      const path = join(dir, artifact);
      const original = Buffer.from('{"existing":"preserve exactly"}\n');
      writeFileSync(path, original);
      assert.throws(() => bindManifest(dir, { task: {}, options: {}, gitCommit: "abc", graderHash: "123" }), /existing run has no checkpoint manifest/);
      assert.deepEqual(readFileSync(path), original, artifact);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("restored budget retains uncertain costs, merges independent processes and imports idempotently", () => {
  const first = new CallBudget({ calls: 8, usd: 2 });
  first.settle(first.reserve(0.4), 0.1);
  first.reserve(0.6); // Provider outcome unknown at the interruption.
  const state = first.exportState();
  const second = new CallBudget({ calls: 8, usd: 2 });
  second.restore(state);
  second.restore(state);
  assert.deepEqual(second.snapshot(), { attempts: 2, chargedUsd: 0.1, reservedUsd: 0.6 });
  second.settle(second.reserve(0.3), 0.2);
  assert.deepEqual(second.snapshot(), { attempts: 3, chargedUsd: 0.30000000000000004, reservedUsd: 0.6 });
  assert.throws(() => second.reserve(1.2), /spend cap/);
  assert.throws(() => new CallBudget({ calls: 9, usd: 2 }).restore(state), /caps differ/);
  assert.throws(() => second.restore({ ...state, sources: [{ ...state.sources[0], reservations: [[99, 0.1]] }] }), /reservation/);
});

test("restored simulator and call counters still enforce the original caps", async () => {
  const guard = makeCallGuard((async () => ({})) as never);
  guard.setCap(2);
  await guard.call("scripted", {} as never);
  const calls = guard.snapshot();
  guard.setCap(2);
  guard.restore(calls);
  await guard.call("scripted", {} as never);
  assert.throws(() => guard.call("scripted", {} as never), /call cap/);
  guard.setCap(3);
  assert.throws(() => guard.restore(calls), /cap differs/);
  setSimCap(2);
  meteredEvaluate("candidate", loadTaskA().initial, "train");
  const meter = meterState();
  setSimCap(2);
  restoreMeter(meter);
  assert.equal(simUsed(), 1);
  meteredEvaluate("candidate", loadTaskA().initial, "train");
  assert.throws(() => meteredEvaluate("candidate", loadTaskA().initial, "train"), /simulator cap/);
  setSimCap(null);
});

test("completed pairs survive restart and an interrupted trailing row is discarded", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-pairs-"));
  const path = join(dir, "pairs.jsonl");
  try {
    const row = { factory: "factory-f", rep: 1, outcome: "win" };
    writeFileSync(path, JSON.stringify(row) + '\n{"factory":"partial');
    assert.deepEqual(readCompletedPairs(path), [row]);
    assert.equal(readFileSync(path, "utf8"), JSON.stringify(row) + "\n");
    appendFileSync(path, JSON.stringify(row) + "\n");
    assert.throws(() => readCompletedPairs(path), /duplicate persisted/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
