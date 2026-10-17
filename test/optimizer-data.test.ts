import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { evaluateDoD, DEFAULT_DOD } from "../src/sim/dod.ts";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario, SPLITS } from "../src/sim/scenarios.ts";
import { graderHash } from "../src/sim/version.ts";
import { validateForTask } from "../src/tasks/task.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "../src/training/generate.ts";
import { applyAction, betterCandidate, measureLayout, optimizerMessages, parseAction } from "../src/training/optimizer.ts";
import { DEFAULT_OPTIMIZER_DATA_OPTIONS, exportOptimizerData, generateOptimizerData, legalMoveActions, optimizerChatExample, type OptimizerDataOptions } from "../src/training/optimizer-data.ts";

const options: OptimizerDataOptions = { ...DEFAULT_OPTIMIZER_DATA_OPTIONS, buildings: { train: 1, validation: 1, test: 1 }, examplesPerBuilding: 4, candidates: 32 };
const exclusions = () => ({ buildings: new Set([buildingHash(generateBuilding(options.seed, "excluded"))]), layouts: new Set<string>(), sources: [] });
const freshDays = (["normal", "peak", "fragile", "skewed"] as const).map((profile, i) => ({ seed: 87_600_000 + i, profile, count: 100 }));

test("optimizer actions strictly reject malformed and extra output", () => {
  assert.deepEqual(parseAction('{"op":"stop"}'), { op: "stop" });
  assert.deepEqual(parseAction('{"op":"move","stationId":"pack-A-1","x":3,"y":4}'), { op: "move", stationId: "pack-A-1", x: 3, y: 4 });
  for (const bad of ['[]', 'null', '{"op":"stop","reason":"done"}', '{"op":"move","stationId":"x","x":0.5,"y":1}', '{"op":"move","stationId":"x","x":1,"y":1,"score":0}', '```json\n{"op":"stop"}\n```']) assert.throws(() => parseAction(bad));
});

test("legal transitions preserve all attributes except one editable station position", () => {
  const task = generateBuilding(2026101702, "transition");
  const original = structuredClone(task.initial);
  const moves = legalMoveActions(task, original, 487, 32);
  assert.equal(moves.length, 32);
  assert.deepEqual(moves, legalMoveActions(task, original, 487, 32));
  for (const action of moves) {
    assert.equal(action.op, "move");
    if (action.op !== "move") continue;
    const after = applyAction(task, original, action);
    assert.deepEqual(validateForTask(after, task), []);
    assert.equal(after.stations.filter((station, i) => JSON.stringify(station) !== JSON.stringify(original.stations[i])).length, 1);
    const reverted = structuredClone(after);
    const index = reverted.stations.findIndex(station => station.id === action.stationId);
    reverted.stations[index] = structuredClone(original.stations[index]);
    assert.deepEqual(reverted, original);
  }
  assert.deepEqual(task.initial, original);
  const fixed = original.stations.find(station => task.fixed.includes(station.id))!;
  assert.throws(() => applyAction(task, original, { op: "move", stationId: fixed.id, x: 1, y: 1 }), /fixed/);
  const station = original.stations.find(item => item.kind === "pack")!;
  assert.throws(() => applyAction(task, original, { op: "move", stationId: station.id, x: -1, y: 1 }), /Illegal/);
  assert.throws(() => applyAction(task, original, { op: "move", stationId: station.id, x: station.x, y: station.y }), /change/);
  assert.throws(() => applyAction(task, original, { op: "move", stationId: "missing", x: 1, y: 1 }), /Unknown/);
});

test("optimizer feedback is exactly unchanged simulator output and preserves grader", () => {
  const task = generateBuilding(2026101704, "metrics"), hash = graderHash();
  const measured = measureLayout(task, task.initial, freshDays);
  const direct = freshDays.map(day => simulate(task.initial, makeScenario(day.seed, day.profile, day.count)));
  assert.deepEqual(measured.days.map(day => day.metrics), direct.map(result => result.metrics));
  assert.deepEqual(measured.checks, evaluateDoD(DEFAULT_DOD, direct).checks);
  assert.equal(measured.objective, direct.reduce((sum, result) => sum + result.metrics.objective, 0) / 4);
  assert.equal(graderHash(), hash);
  assert.throws(() => measureLayout(task, task.initial, [{ ...Object.values(SPLITS).flat()[0], count: 100 }]), /fresh/);
  assert.throws(() => measureLayout(task, task.initial, [freshDays[0], freshDays[0]]), /unique/);
});

test("improvement gate rejects score ties, changed demands and loss of an already passed day", () => {
  const task = generateBuilding(2026101704, "gate");
  const before = measureLayout(task, task.initial, freshDays), after = structuredClone(before);
  assert.equal(betterCandidate(before, after), false);
  after.objective = before.objective! - 1;
  assert.equal(betterCandidate(before, after), true);
  after.days[0].seed++;
  assert.equal(betterCandidate(before, after), false);
  after.days[0].seed = before.days[0].seed;
  before.checks.find(check => check.id === "damaged")!.passed = false;
  before.days[0].metrics.damaged = 0;
  after.days[0].metrics.damaged = 1;
  assert.equal(betterCandidate(before, after), false);
});

test("generated transitions reproduce verified improvement on feedback and independent gate days", () => {
  const generated = generateOptimizerData(options, undefined, exclusions());
  assert.equal(generated.rows.length, 8);
  assert.equal(generated.cases.length, 1);
  for (const row of generated.rows) {
    assert.deepEqual(applyAction(row.task, row.before, row.action), row.after);
    assert.equal(layoutHash(row.before), row.beforeHash);
    assert.equal(layoutHash(row.after), row.afterHash);
    assert.equal(betterCandidate(row.feedback.before, row.feedback.after), true);
    assert.equal(betterCandidate(row.gate.before, row.gate.after), true);
    assert.equal(new Set([...row.feedbackDays, ...row.gateDays].map(day => day.seed)).size, 8);
    assert.deepEqual(measureLayout(row.task, row.after, row.gateDays), row.gate.after);
  }
  assert.ok(generated.rows.some(row => row.trajectoryStep > 0));
  const repeated = generateOptimizerData(options, undefined, exclusions());
  assert.deepEqual(repeated.rows, generated.rows);
  assert.deepEqual(repeated.cases, generated.cases);
});

test("split identities exclude prior buildings and test contains no measured outcomes", () => {
  const generated = generateOptimizerData(options, undefined, exclusions());
  const seenBuildings = new Set(exclusions().buildings), seenDays = new Set<number>();
  for (const split of ["train", "validation", "test"]) {
    for (const hash of generated.splitBuildingHashes[split]) { assert.ok(!seenBuildings.has(hash)); seenBuildings.add(hash); }
    for (const seed of generated.splitDemandSeeds[split]) { assert.ok(!seenDays.has(seed)); seenDays.add(seed); }
  }
  const heldout = generated.cases[0];
  assert.deepEqual(Object.keys(heldout).sort(), ["id", "split", "buildingId", "buildingHash", "geometrySeed", "initialLayoutHash", "task", "initial", "feedbackDays", "finalDays"].sort());
  assert.deepEqual(validateForTask(heldout.initial, heldout.task), []);
  assert.equal(buildingHash(heldout.task), heldout.buildingHash);
});

test("stop labels require exhausted sampled moves and remain below ten percent", () => {
  const tinySearch = { ...options, examplesPerBuilding: 20, candidates: 1 };
  const generated = generateOptimizerData(tinySearch, undefined, { buildings: new Set(), layouts: new Set(), sources: [] });
  const stops = generated.rows.filter(row => row.action.op === "stop");
  assert.ok(stops.length > 0);
  for (const building of new Set(generated.rows.map(row => row.buildingId))) assert.ok(stops.filter(row => row.buildingId === building).length <= 2);
  for (const row of stops) {
    assert.equal(row.labelReason, "bounded-search-exhausted");
    assert.deepEqual(row.before, row.after);
    assert.deepEqual(row.feedback.before, row.feedback.after);
    for (const action of legalMoveActions(row.task, row.before, row.search.seed, tinySearch.candidates)) {
      const candidate = measureLayout(row.task, applyAction(row.task, row.before, action), row.feedbackDays);
      assert.equal(betterCandidate(row.feedback.before, candidate), false);
    }
  }
});

test("optimizer messages include only current observations and action target", () => {
  const row = generateOptimizerData(options, undefined, exclusions()).rows[0];
  const input = JSON.parse(optimizerMessages(row.task, row.before, row.feedback.before)[1].content);
  assert.deepEqual(Object.keys(input).sort(), ["version", "goal", "simulator", "constraints", "layout", "observation", "previousAttempts"].sort());
  for (const privateField of ["afterHash", "gateDays", "feedbackDays", "trajectoryStep", "search", "buildingId"]) assert.equal(JSON.stringify(input).includes(`"${privateField}"`), false);
  const chat = optimizerChatExample(row);
  assert.deepEqual(chat.messages.map(message => message.role), ["system", "user", "assistant"]);
  assert.deepEqual(parseAction(chat.messages[2].content), row.action);
});

test("previous attempt feedback changes retry prompts without exposing gate or final labels", () => {
  const generated = generateOptimizerData(options, undefined, exclusions());
  const row = generated.rows[0];
  const original = optimizerMessages(row.task, row.before, row.feedback.before);
  const retry = optimizerMessages(row.task, row.before, row.feedback.before, [{ action: row.action, status: "rejected", reason: "Measured candidate did not improve", feedback: row.feedback.after }]);
  assert.notDeepEqual(original, retry);
  const input = JSON.parse(retry[1].content);
  assert.equal(input.previousAttempts[0].status, "rejected");
  assert.deepEqual(input.previousAttempts[0].action, row.action);
  assert.equal(JSON.stringify(input).includes('"seed"'), false);
  assert.equal(JSON.stringify(input).includes('"gate"'), false);
  const later = generated.rows.find(item => item.trajectoryStep > 0)!;
  assert.equal(later.previousAttempts.length, later.trajectoryStep);
  assert.ok(later.previousAttempts.every(attempt => attempt.status === "accepted"));
  const chat = optimizerChatExample(later);
  assert.equal(JSON.parse(chat.messages[1].content).previousAttempts.length, later.trajectoryStep);
});

test("optimizer export freezes hashes and separates deployable data from sealed tests", () => {
  const parent = resolve("runs/optimizer-data"); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, ".test-")), output = join(base, "dataset");
  try {
    const manifest = exportOptimizerData(output, options, undefined, exclusions());
    assert.equal(manifest.taskProfile, "optimizer");
    assert.equal(manifest.stats.test.scored, false);
    assert.equal(manifest.stats.stopLabels, 0);
    for (const [file, info] of Object.entries(manifest.files)) {
      const contents = readFileSync(join(output, file), "utf8");
      assert.equal(contentHash(contents), info.sha256); assert.equal(Buffer.byteLength(contents), info.bytes);
    }
    assert.throws(() => exportOptimizerData(output, options, undefined, exclusions()), /new directory/);
    assert.throws(() => exportOptimizerData("layouts/optimizer", options, undefined, exclusions()), /inside runs/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
