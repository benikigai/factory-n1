import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario, SPLITS } from "../src/sim/scenarios.ts";
import { graderHash } from "../src/sim/version.ts";
import { criticInput, criticMessages, labelLayout } from "../src/training/critic.ts";
import { chatExample, exportDataset, generateDataset, type DatasetOptions } from "../src/training/dataset.ts";
import { buildingHash, contentHash, generateBuilding, generateCandidate } from "../src/training/generate.ts";

const small: DatasetOptions = { seed: 20261017, buildings: { train: 2, validation: 1, test: 1 }, examplesPerBuilding: 20 };
const freshDemand = [{ seed: 5_000_001, profile: "normal" as const, count: 100 }];

test("labels match the unchanged simulator and reject reserved seeds", () => {
  const task = generateBuilding(20261017, "new-building");
  const before = graderHash();
  const { output } = labelLayout(task, task.initial, freshDemand);
  const direct = simulate(task.initial, makeScenario(freshDemand[0].seed, "normal", 100));
  assert.equal(output.valid, true);
  for (const metric of ["objective", "makespan", "damaged", "missorts", "unshipped"] as const) assert.equal(output.metrics![metric], direct.metrics[metric]);
  assert.equal(output.zeroDamage, direct.metrics.damaged === 0);
  assert.equal(output.allShipped, direct.metrics.unshipped === 0);
  assert.equal(graderHash(), before);
  for (const day of Object.values(SPLITS).flat()) assert.throws(() => labelLayout(task, task.initial, [{ ...day, count: 100 }]), /non-reserved/);
});

test("invalid layouts never receive simulated numeric labels", () => {
  const task = generateBuilding(20261018, "new-building");
  for (const index of [17, 18, 19]) {
    const { layout } = generateCandidate(task, 500 + index, index);
    const { output, days } = labelLayout(task, layout, freshDemand);
    assert.equal(output.valid, false);
    assert.ok(output.errors.length);
    assert.equal(output.metrics, null);
    assert.equal(output.goalMet, null);
    assert.deepEqual(days, []);
  }
});

test("dataset is deterministic, disjoint by building/layout/demand, and has diverse labels", () => {
  const first = generateDataset(small);
  assert.deepEqual(first, generateDataset(small));
  assert.equal(first.length, 80);
  assert.equal(new Set(first.map(row => row.layoutHash)).size, first.length);
  for (const field of ["buildingHash", "layoutHash"] as const) {
    const ownership = new Map<string, string>();
    for (const row of first) {
      assert.ok(!ownership.has(row[field]) || ownership.get(row[field]) === row.split);
      ownership.set(row[field], row.split);
    }
  }
  const demands = new Map<number, string>();
  for (const row of first) for (const day of row.input.demand) {
    assert.ok(!demands.has(day.seed) || demands.get(day.seed) === row.split);
    demands.set(day.seed, row.split);
  }
  assert.ok(first.some(row => !row.output.valid));
  assert.ok(first.some(row => row.output.zeroDamage));
  assert.ok(first.some(row => row.output.valid && !row.output.zeroDamage));
  assert.ok(first.some(row => row.output.goalMet));
  const uncovered = generateBuilding(20261017, "missing-dock", true);
  assert.equal(labelLayout(uncovered, uncovered.initial, freshDemand).output.allShipped, false);
});

test("rotating or reflecting a building keeps the same grouping identity", () => {
  const task = generateBuilding(20261017, "original");
  const mirrored = structuredClone(task);
  mirrored.initial.stations.forEach(s => { s.x = task.initial.grid.w - 1 - s.x; });
  assert.equal(buildingHash(task), buildingHash(mirrored));
});

test("single-turn JSONL inputs omit labels, families and split identifiers", () => {
  const row = generateDataset({ ...small, buildings: { train: 1, validation: 1, test: 1 }, examplesPerBuilding: 1 })[0];
  const messages = criticMessages(row.input);
  assert.deepEqual(messages.map(message => message.role), ["system", "user"]);
  const prompt = JSON.parse(messages[1].content);
  assert.deepEqual(Object.keys(prompt).sort(), ["constraints", "demand", "goal", "layout", "simulator", "version"]);
  assert.equal(prompt.layout.name, "candidate");
  assert.deepEqual(chatExample(row).messages.map(message => message.role), ["system", "user", "assistant"]);
  assert.deepEqual(JSON.parse(chatExample(row).messages[2].content), row.output);
  assert.equal(JSON.stringify(prompt), JSON.stringify(criticInput(generateBuilding(row.geometrySeed, row.buildingId), row.input.layout, row.input.demand)));
});

test("export hashes its files, keeps holdout separate, and refuses overwrites", () => {
  const parent = resolve("runs/finetune-data");
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, ".test-")), output = join(base, "dataset");
  try {
    const manifest = exportDataset(output, { ...small, buildings: { train: 1, validation: 1, test: 1 }, examplesPerBuilding: 2 });
    for (const [file, info] of Object.entries(manifest.files)) {
      const contents = readFileSync(join(output, file), "utf8");
      assert.equal(contentHash(contents), info.sha256);
      assert.equal(Buffer.byteLength(contents), info.bytes);
    }
    assert.equal(manifest.stats.test.examples, 2);
    assert.throws(() => exportDataset(output, small), /new directory/);
    assert.throws(() => exportDataset("layouts/new-dataset", small), /inside runs/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
