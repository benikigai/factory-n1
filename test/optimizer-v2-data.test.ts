import assert from "node:assert/strict";
import { test } from "node:test";
import { SIM } from "../src/sim/config.ts";
import { graderHash } from "../src/sim/version.ts";
import { validateForTask } from "../src/tasks/task.ts";
import { generateBuilding, buildingHash, layoutHash } from "../src/training/generate.ts";
import { applyAction, betterCandidate, measureLayout, optimizerMessages } from "../src/training/optimizer.ts";
import { DEFAULT_V2_OPTIONS, V2_FIXTURE_SEED, generateV2Data, geometricEndpoint, geometricTeacherPlan, transportEdges } from "../src/training/optimizer-v2-data.ts";

const options = { seed: V2_FIXTURE_SEED, buildings: { train: 1, validation: 1, test: 1 } };
const exclusions = { buildings: new Set<string>(), sources: [] };

test("geometric teacher certifies safe endpoint and reports feedback search cost", () => {
  const data = generateV2Data(options, undefined, exclusions);
  const row = data.rows.find(row => row.trajectoryLength === 6 && row.trajectoryStep === 0)!;
  const hash = graderHash();
  const endpoint = geometricEndpoint(row.task, row.before);
  assert.ok(endpoint.feasible && endpoint.layout);
  assert.deepEqual(validateForTask(endpoint.layout, row.task), []);
  assert.ok(transportEdges(endpoint.layout).every(edge => edge.cells <= SIM.fragileMaxLeg));
  const plan = geometricTeacherPlan(row.task, row.before, row.feedbackDays);
  assert.ok(plan.feedbackSimulationCalls >= 0);
  assert.equal(plan.feedbackSimulationCalls, plan.simulatorCalls);
  if (plan.actions) {
    let layout = row.before;
    for (const action of plan.actions) {
      const next = applyAction(row.task, layout, action);
      assert.ok(betterCandidate(measureLayout(row.task, layout, row.feedbackDays), measureLayout(row.task, next, row.feedbackDays)));
      layout = next;
    }
    assert.ok(transportEdges(layout).every(edge => edge.cells <= SIM.fragileMaxLeg));
  }
  assert.equal(graderHash(), hash);
  assert.throws(() => geometricEndpoint(row.task, row.before, 0), /search limit/);
});

test("v2 targets are legal improvements and complete contiguous paths to the full goal", () => {
  const data = generateV2Data(options, undefined, exclusions);
  assert.equal(data.rows.length, 40);
  const groups = new Map<string, typeof data.rows>();
  for (const row of data.rows) {
    assert.deepEqual(applyAction(row.task, row.before, row.action), row.after);
    assert.equal(row.beforeHash, layoutHash(row.before));
    assert.equal(row.afterHash, layoutHash(row.after));
    if (row.action.op === "move") {
      assert.ok(betterCandidate(row.feedback.before, row.feedback.after));
      assert.ok(betterCandidate(row.gate.before, row.gate.after));
    } else assert.ok(row.feedback.after.goalMet && row.gate.after.goalMet);
    const key = `${row.buildingId}/${row.trajectory}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    const ordered = rows.sort((a, b) => a.trajectoryStep - b.trajectoryStep);
    for (let i = 1; i < ordered.length; i++) assert.deepEqual(ordered[i - 1].after, ordered[i].before);
    const last = ordered.at(-1)!;
    assert.ok(last.feedback.after.goalMet && last.gate.after.goalMet);
    assert.equal(last.endpointHash, last.afterHash);
  }
  assert.ok(data.rows.filter(row => row.feedback.after.goalMet && row.gate.after.goalMet).length >= data.rows.length / 2);
});

test("negative histories are real failed actions and include measured rejection feedback", () => {
  const data = generateV2Data(options, undefined, exclusions);
  const statuses = new Set(data.rows.flatMap(row => row.previousAttempts.map(attempt => attempt.status)));
  assert.deepEqual(statuses, new Set(["invalid", "rejected", "accepted"]));
  assert.ok(data.rows.some(row => !row.previousAttempts.length));
  for (const row of data.rows) for (const attempt of row.previousAttempts) {
    if (attempt.status === "invalid") assert.throws(() => applyAction(row.task, row.before, attempt.action!), { message: attempt.reason });
    if (attempt.status === "rejected") {
      const layout = applyAction(row.task, row.before, attempt.action!);
      const measured = measureLayout(row.task, layout, row.feedbackDays);
      assert.deepEqual(measured, attempt.feedback);
      assert.equal(betterCandidate(row.feedback.before, measured), false);
    }
    const messages = optimizerMessages(row.task, row.before, row.feedback.before, row.previousAttempts);
    const prompt = JSON.parse(messages[1].content);
    assert.equal(prompt.previousAttempts[0].status, attempt.status);
    assert.equal(messages[1].content.includes('"gate"'), false);
    assert.equal(messages[1].content.includes('"endpointHash"'), false);
  }
});

test("all new geometries are disjoint and held-out cases contain no scores or teacher labels", () => {
  assert.notEqual(options.seed, DEFAULT_V2_OPTIONS.seed);
  assert.throws(() => generateV2Data(options, undefined, { ...exclusions, demands: new Set([options.seed + 400_000_000]) }), /Demand seed overlaps/);
  const excluded = buildingHash(generateBuilding(options.seed, "excluded"));
  const data = generateV2Data(options, undefined, { ...exclusions, buildings: new Set([excluded]) });
  const hashes = Object.values(data.splitBuildingHashes).flat();
  assert.equal(new Set(hashes).size, 3);
  assert.equal(hashes.includes(excluded), false);
  assert.equal(data.cases.length, 1);
  assert.deepEqual(Object.keys(data.cases[0]).sort(), ["id", "split", "buildingId", "buildingHash", "geometrySeed", "initialLayoutHash", "task", "initial", "feedbackDays", "finalDays"].sort());
  const seedSets = Object.values(data.splitDemandSeeds).flat();
  assert.equal(new Set(seedSets).size, seedSets.length);
  const repeated = generateV2Data(options, undefined, { ...exclusions, buildings: new Set([excluded]) });
  assert.deepEqual(data.rows, repeated.rows);
  assert.deepEqual(data.cases, repeated.cases);
});
