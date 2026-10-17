import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario, SPLITS } from "../src/sim/scenarios.ts";
import { DEFAULT_DOD, evaluateDoD } from "../src/sim/dod.ts";
import { graderHash } from "../src/sim/version.ts";
import { validateForTask } from "../src/tasks/task.ts";
import { buildingHash, contentHash, layoutHash } from "../src/training/generate.ts";
import { applyAction, optimizerMessages, parseAction } from "../src/training/optimizer.ts";

const FROZEN_GRADER = "493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4";
const json = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const lines = (path: string): any[] => readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const eq = (a: unknown, b: unknown, why: string) => assert.deepEqual(a, b, why);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let simulatorCalls = 0;

// Derive receipts directly from the unchanged simulator, independently of the
// teacher's measureLayout and betterCandidate implementations.
function measure(task: any, layout: any, days: any[]) {
  eq(validateForTask(layout, task), [], "Legal layout");
  const runs = days.map(day => simulate(layout, makeScenario(day.seed, day.profile, day.count)));
  simulatorCalls += runs.length;
  const dod = evaluateDoD(DEFAULT_DOD, runs);
  const keys = ["objective", "makespan", "damaged", "missorts", "unshipped", "avgWait", "travelCells"];
  const metrics: any = Object.fromEntries(keys.map(key => [key, mean(runs.map(run => (run.metrics as any)[key]))]));
  const bottlenecks = layout.stations.filter((s: any) => ["sorter", "pack"].includes(s.kind)).map((station: any) => {
    const stats = runs.map(run => run.metrics.stations[station.id]);
    return { stationId: station.id, maxQueue: Math.max(...stats.map(s => s.maxQueue)), totalWait: mean(stats.map(s => s.totalWait)), utilization: mean(stats.map(s => s.utilization)) };
  }).sort((a: any, b: any) => b.totalWait - a.totalWait || a.stationId.localeCompare(b.stationId));
  return { valid: true, errors: [], objective: metrics.objective, goalMet: dod.passed, checks: dod.checks, metrics, bottlenecks,
    days: runs.map(run => ({ seed: run.scenario.seed, profile: run.scenario.profile, metrics: run.metrics })) };
}

function improves(before: any, after: any) {
  if (after.objective >= before.objective - 1e-9) return false;
  eq(before.days.map((d: any) => [d.seed, d.profile]), after.days.map((d: any) => [d.seed, d.profile]), "Matched acceptance days");
  const pass = (m: any, c: any) => c.op === "==" ? m[c.metric] === c.value : c.op === "<=" ? m[c.metric] <= c.value : m[c.metric] >= c.value;
  return before.days.every((day: any, i: number) => before.checks.every((c: any) => !pass(day.metrics, c) || pass(after.days[i].metrics, c)));
}

function assertDays(days: any[]) {
  eq(days.map(d => d.profile).sort(), ["fragile", "normal", "peak", "skewed"], "Four demand profiles");
  assert.equal(new Set(days.map(d => d.seed)).size, 4, "Distinct demand days");
  for (const day of days) assert.ok(Number.isSafeInteger(day.seed) && day.count === 100, "Fresh integer seed and 100 packages");
}

const directory = resolve(process.argv[2] ?? "runs/optimizer-data/v2");
const output = process.argv[3];
assert.ok(directory.includes("/runs/optimizer-data/"), "Only a local optimizer dataset is allowed");
const manifest = json(join(directory, "manifest.json"));
const old = json("runs/optimizer-data/v1/manifest.json");
const archived = json("runs/optimizer-recovery/optimizer/manifest.json");
assert.equal(archived.baseModel, "nvidia/Llama-3.1-Nemotron-Nano-8B-v1");
assert.equal(archived.baseRevision, "54641c1611fcff44fa4865626462445e0a153fc7");
assert.equal(archived.status, "complete"); assert.equal(archived.epochs, 1); assert.equal(archived.rank, 8);
for (const name of ["train.jsonl", "validation.jsonl"]) {
  assert.equal(hashFile(join("runs/optimizer-data/v1", name)), archived.dataset.files[name], `Archived v1 data ${name}`);
  assert.equal(old.files[name].sha256, archived.dataset.files[name]);
}
for (const [name, hash] of Object.entries(archived.adapterHashes)) assert.equal(hashFile(join("runs/optimizer-recovery/optimizer/adapter", name)), hash, `Archived adapter ${name}`);
assert.equal(graderHash(), FROZEN_GRADER);
assert.equal(manifest.graderHash, FROZEN_GRADER);
assert.equal(manifest.taskProfile, "optimizer");
assert.equal(manifest.promptProfile, "factory-single-move-optimizer-v1");
for (const [path, hash] of Object.entries(manifest.sourceHashes)) assert.equal(hashFile(path), hash, `Frozen source ${path}`);
assert.equal(hashFile("src/training/optimizer.ts"), old.sourceHashes["src/training/optimizer.ts"], "Same prompt, observation, action and acceptance code as v1");
const raw = lines(join(directory, "raw-transitions.jsonl"));
const chat: Record<string, any[]> = {};
for (const name of ["train.jsonl", "validation.jsonl", "raw-transitions.jsonl"]) {
  const bytes = readFileSync(join(directory, name));
  assert.equal(contentHash(bytes.toString("utf8")), manifest.files[name].sha256, `Content hash ${name}`);
  assert.equal(bytes.length, manifest.files[name].bytes, `Byte count ${name}`);
  if (name !== "raw-transitions.jsonl") chat[name.slice(0, -6)] = lines(join(directory, name));
}
assert.equal(raw.length, 1400);
assert.equal(chat.train.length, 1200); assert.equal(chat.validation.length, 200);

// Use published manifest identities for the new test. Do not read or parse its
// file before all checkpoint choices and budgets are frozen by the evaluator.
const excluded = new Set<string>(manifest.excludedBuildingHashes);
const oldBuildings = new Set<string>([...old.excludedBuildingHashes, ...Object.values(old.splitBuildingHashes).flat()] as string[]);
const priorSeeds = new Set<number>([...Object.values(SPLITS).flat().map(d => d.seed), ...Object.values(old.splitDemandSeeds).flat()] as number[]);
const exploratory = json("runs/optimizer-v2-assessment/geometric-feasibility.json");
for (const row of exploratory.results) {
  oldBuildings.add(row.buildingHash);
  for (const d of [...row.start.days, ...row.final.days]) priorSeeds.add(d.seed);
}
for (const row of lines("runs/finetune-data/critic-v1/raw-labels.jsonl")) for (const d of row.input.demand) priorSeeds.add(d.seed);
for (const path of ["runs/optimizer-data/v2-benchmark/manifest.json", "runs/optimizer-data/v2-consumed-development.json", "runs/optimizer-data/v2-fixture-exclusions.json"]) {
  if (!existsSync(path)) continue;
  const development = json(path);
  for (const hash of development.buildingHashes ?? Object.values(development.splitBuildingHashes).flat()) oldBuildings.add(hash as string);
  for (const seed of development.demandSeeds ?? Object.values(development.splitDemandSeeds).flat()) priorSeeds.add(seed as number);
}
for (const source of manifest.exclusionSources) assert.equal(hashFile(source.path), source.sha256, `Exclusion source ${source.path}`);
for (const hash of oldBuildings) assert.ok(excluded.has(hash), "Previously consumed geometry is explicitly excluded");
for (const seed of priorSeeds) assert.ok(manifest.excludedDemandSeeds.includes(seed), "Previously consumed demand is explicitly excluded");
const allBuildings = new Set<string>(oldBuildings);
const expectedCounts: Record<string, number> = { train: 60, validation: 10, test: 20 };
for (const split of ["train", "validation", "test"]) {
  const hashes = manifest.splitBuildingHashes[split];
  assert.equal(hashes.length, expectedCounts[split], `Building count ${split}`);
  for (const hash of hashes) { assert.ok(!allBuildings.has(hash), `Geometry leak or duplicate ${split}`); allBuildings.add(hash); }
  const seeds = manifest.splitDemandSeeds[split];
  for (const seed of new Set<number>(seeds)) {
    assert.ok(Number.isSafeInteger(seed) && !priorSeeds.has(seed), `Demand overlap ${split}`);
    priorSeeds.add(seed);
  }
}

const indices: Record<string, number> = { train: 0, validation: 0 };
const rawBuildings: Record<string, Set<string>> = { train: new Set(), validation: new Set() };
const rawSeeds: Record<string, Set<number>> = { train: new Set(), validation: new Set() };
const promptHashes = new Set<string>();
const stats = { moves: 0, stops: 0, nonGoalStops: 0, goalTargets: 0, correctionHistories: 0, verifiedInvalidHistories: 0, verifiedRejectedHistories: 0, acceptedHistories: 0, emptyHistories: 0, sorterTargets: 0, packTargets: 0 };
const trajectories = new Map<string, any[]>();
for (const row of raw) {
  assert.ok(["train", "validation"].includes(row.split), "Training raw file cannot contain a test row");
  assert.equal(buildingHash(row.task), row.buildingHash, "Canonical geometry identity");
  assert.ok(manifest.splitBuildingHashes[row.split].includes(row.buildingHash));
  rawBuildings[row.split].add(row.buildingHash);
  assert.equal(layoutHash(row.before), row.beforeHash); assert.equal(layoutHash(row.after), row.afterHash);
  const action = parseAction(JSON.stringify(row.action));
  eq(applyAction(row.task, row.before, action), row.after, `Action reproduces target ${row.id}`);
  for (const days of [row.feedbackDays, row.gateDays]) {
    assertDays(days);
    for (const d of days) rawSeeds[row.split].add(d.seed);
  }
  assert.equal(new Set([...row.feedbackDays, ...row.gateDays].map(d => d.seed)).size, 8, "Independent feedback and gate days");
  const feedback = { before: measure(row.task, row.before, row.feedbackDays), after: measure(row.task, row.after, row.feedbackDays) };
  const gate = { before: measure(row.task, row.before, row.gateDays), after: measure(row.task, row.after, row.gateDays) };
  eq(feedback, row.feedback, `Independent feedback receipt ${row.id}`); eq(gate, row.gate, `Independent gate receipt ${row.id}`);
  if (action.op === "move") {
    stats.moves++;
    assert.ok(improves(feedback.before, feedback.after) && improves(gate.before, gate.after), `Strict improvement with no passed-check regression ${row.id}`);
    const kind = row.before.stations.find((s: any) => s.id === action.stationId).kind;
    if (kind === "sorter") stats.sorterTargets++; else stats.packTargets++;
  } else {
    stats.stops++;
    if (!(feedback.before.goalMet && gate.before.goalMet)) stats.nonGoalStops++;
    assert.ok(feedback.before.goalMet && gate.before.goalMet, "V2 stop certifies the full goal on both training day sets");
  }
  if (feedback.after.goalMet && gate.after.goalMet) stats.goalTargets++;
  if (row.previousAttempts.some((a: any) => a.status === "invalid" || a.status === "rejected")) stats.correctionHistories++;
  // A rejection does not change the state, so replay it from this row's input.
  // Accepted history is checked against the previous trajectory row below.
  if (!row.previousAttempts.length) stats.emptyHistories++;
  for (const attempt of row.previousAttempts) {
    if (attempt.status === "invalid") {
      assert.throws(() => applyAction(row.task, row.before, parseAction(JSON.stringify(attempt.action))), "Invalid history must truly be illegal");
      stats.verifiedInvalidHistories++;
    } else if (attempt.status === "rejected") {
      const rejected = applyAction(row.task, row.before, parseAction(JSON.stringify(attempt.action)));
      const result = measure(row.task, rejected, row.feedbackDays);
      eq(result, attempt.feedback, `Rejected history receipt ${row.id}`);
      assert.equal(improves(feedback.before, result), false, "Rejected history must fail the existing acceptance rule");
      stats.verifiedRejectedHistories++;
    } else { assert.equal(attempt.status, "accepted"); stats.acceptedHistories++; }
  }
  const trajectoryKey = `${row.buildingId}:${row.trajectory}`;
  trajectories.set(trajectoryKey, [...(trajectories.get(trajectoryKey) ?? []), row]);
  const expected = { messages: [...optimizerMessages(row.task, row.before, feedback.before, row.previousAttempts), { role: "assistant", content: JSON.stringify(action) }] };
  eq(chat[row.split][indices[row.split]++], expected, `Canonical train/eval prompt and verified action ${row.id}`);
  const promptHash = contentHash(expected.messages.slice(0, -1));
  assert.ok(!promptHashes.has(promptHash), "Duplicate prompt across training or validation"); promptHashes.add(promptHash);
  const input = expected.messages[1].content;
  for (const d of row.gateDays) assert.ok(!input.includes(String(d.seed)), "Gate day excluded from prompt");
}
for (const path of trajectories.values()) {
  path.sort((a, b) => a.trajectoryStep - b.trajectoryStep);
  const length = path[0].trajectoryLength;
  assert.equal(path.length, Math.max(1, length), "Complete recorded curriculum trajectory");
  for (let i = 0; i < path.length; i++) {
    assert.equal(path[i].trajectoryStep, i);
    assert.equal(path[i].trajectoryLength, length);
    assert.equal(path[i].endpointHash, path[0].endpointHash);
    if (i) eq(path[i].before, path[i - 1].after, "Trajectory states are contiguous");
    for (const attempt of path[i].previousAttempts.filter((a: any) => a.status === "accepted")) {
      assert.ok(i > 0, "Accepted history has a preceding recorded action");
      eq(attempt.action, path[i - 1].action, "Accepted history action matches the trajectory");
      eq(attempt.feedback, path[i - 1].feedback.after, "Accepted history feedback matches the trajectory");
    }
  }
  assert.equal(path.at(-1).afterHash, path[0].endpointHash, "Trajectory reaches its certified endpoint");
}
let reservedTrainingDemandSeeds = 0;
for (const split of ["train", "validation"]) {
  eq([...rawBuildings[split]].sort(), [...manifest.splitBuildingHashes[split]].sort(), `Raw geometry matches ${split} manifest`);
  const registered = new Set<number>(manifest.splitDemandSeeds[split]);
  for (const seed of rawSeeds[split]) assert.ok(registered.has(seed), `Every accepted ${split} demand is registered`);
  reservedTrainingDemandSeeds += registered.size - rawSeeds[split].size;
}
assert.equal(manifest.stats.rejectedTrainingGeometries, 0, "Review discarded geometry episodes if the generator starts using them");
assert.equal(reservedTrainingDemandSeeds, manifest.stats.rejectedTrainingDemandDraws * 8, "Unused registered demand matches discarded eight-day curriculum draws");
assert.equal(graderHash(), FROZEN_GRADER, "Grader unchanged through audit");
for (const [path, hash] of Object.entries(manifest.sourceHashes)) assert.equal(hashFile(path), hash, `Source unchanged through audit ${path}`);
const report = { status: "passed", createdAt: new Date().toISOString(), directory, graderHash: FROZEN_GRADER,
  trainingRows: raw.length, simulatorCalls, stats, reservedTrainingDemandSeeds, sealedTestOpened: false,
  testChecks: "Only manifest geometry and demand disjointness verified; evaluator must independently verify sealed file contents after checkpoint freeze.",
  limitation: "Training curriculum selects full-goal demand draws and verifies both day sets during label selection. This audit verifies targets and provenance, not that more epochs or new data improve held-out model performance.",
  manifestHash: hashFile(join(directory, "manifest.json")) };
if (output) {
  assert.ok(!existsSync(output), "Audit receipt must not overwrite prior evidence");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify(report, null, 2));
