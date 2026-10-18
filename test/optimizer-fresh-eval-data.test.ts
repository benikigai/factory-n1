import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTaskA, validateForTask } from "../src/tasks/task.ts";
import { graderHash } from "../src/sim/version.ts";
import { buildingHash, layoutHash } from "../src/training/generate.ts";
import { FRESH_EVAL_OPTIONS, generateFreshCases, validateFreshCases, type FreshExclusions, type FreshOptions } from "../src/training/optimizer-fresh-eval-data.ts";

const options: FreshOptions = { geometrySeed: 100, demandSeed: 3_800_000_000, factories: 20 };
const exclusions = (): FreshExclusions => ({ buildings: new Set(), layouts: new Set(), demands: new Set(), demandRanges: [{ first: 0, last: 2_200_000_000, reason: "previous namespaces" }], sources: [] });
// Deliberately outside the production generator's maximum 24x24 grid. No future sealed
// production geometry is generated, scored, or consumed by these tests.
function fixtureBuilding(seed: number, id: string) {
  const task = structuredClone(loadTaskA());
  task.id = id; task.initial.grid = { w: 40, h: 40 };
  task.initial.stations.find(station => station.id === "recv-1")!.y = 4 + seed % 30;
  task.initial.stations.find(station => station.id === "ship-A")!.x = 39;
  return task;
}

test("fresh generation is deterministic, legal and exactly twenty unscored fixtures", () => {
  const original = graderHash(), prior = exclusions();
  const first = generateFreshCases(prior, options, fixtureBuilding), second = generateFreshCases(prior, options, fixtureBuilding);
  assert.deepEqual(first, second);
  assert.equal(first.cases.length, 20); assert.equal(first.simulatorCalls, 0);
  assert.equal(prior.buildings.size, 0); assert.equal(prior.layouts.size, 0);
  assert.deepEqual(validateFreshCases(first.cases, prior), { factories: 20, uniqueBuildings: 20, uniqueDemandSeeds: 160, scored: false, simulatorCalls: 0 });
  for (const row of first.cases) {
    assert.ok(row.initial.grid.w >= 40);
    assert.deepEqual(validateForTask(row.initial, row.task), []);
    assert.equal(row.initialLayoutHash, layoutHash(row.initial));
    assert.equal(row.buildingHash, buildingHash(row.task));
    assert.equal(JSON.stringify(row).includes('"objective"'), false);
    assert.equal(JSON.stringify(row).includes('"goalMet"'), false);
  }
  assert.equal(graderHash(), original);
});

test("only identity overlap triggers resampling, including previously failed cohorts", () => {
  const prior = exclusions();
  prior.buildings.add(buildingHash(fixtureBuilding(options.geometrySeed, "previous-failed-test")));
  const result = generateFreshCases(prior, options, fixtureBuilding);
  assert.ok(result.identityRetries >= 1);
  assert.equal(result.cases[0].geometrySeed, options.geometrySeed + 1);
  assert.ok(result.cases.every(row => !prior.buildings.has(row.buildingHash)));
  assert.throws(() => generateFreshCases(prior, options, () => fixtureBuilding(options.geometrySeed, "always-previous")), /bounded identity/);
});

test("previous individual demand seeds and rejected-search ranges both fail closed", () => {
  const prior = exclusions(); prior.demands.add(options.demandSeed + 4);
  assert.throws(() => generateFreshCases(prior, options, fixtureBuilding), /Fresh demand overlaps/);
  assert.throws(() => generateFreshCases(exclusions(), { ...options, demandSeed: 5000 }, fixtureBuilding), /Fresh demand overlaps/);
  assert.notEqual(options.geometrySeed, FRESH_EVAL_OPTIONS.geometrySeed);
  assert.notEqual(options.demandSeed, FRESH_EVAL_OPTIONS.demandSeed);
});

test("wrapped seed aliases, fractional seeds, and changed cohort size are rejected", () => {
  for (const change of [{ geometrySeed: 2 ** 32 + 100 }, { demandSeed: 2 ** 32 - 5 }, { geometrySeed: 1.5 }, { factories: 19 }]) {
    assert.throws(() => generateFreshCases(exclusions(), { ...options, ...change }, fixtureBuilding), /exactly 20.*uint32/);
  }
});

test("preflight rejects duplicate factories, changed layouts and embedded outcome fields", () => {
  const cases = generateFreshCases(exclusions(), options, fixtureBuilding).cases;
  const duplicate = structuredClone(cases); duplicate[1] = duplicate[0];
  assert.throws(() => validateFreshCases(duplicate, exclusions()), /identity overlaps/);
  const edited = structuredClone(cases); edited[0].initial.stations[0].x++;
  assert.throws(() => validateFreshCases(edited, exclusions()), /hash mismatches/);
  const scored = structuredClone(cases); Object.assign(scored[0], { finalScore: 10 });
  assert.throws(() => validateFreshCases(scored, exclusions()), /outcome fields/);
});

test("preflight rejects cross-factory and feedback/final demand leakage", () => {
  const cases = generateFreshCases(exclusions(), options, fixtureBuilding).cases;
  const repeated = structuredClone(cases); repeated[1].finalDays[0].seed = repeated[0].feedbackDays[0].seed;
  assert.throws(() => validateFreshCases(repeated, exclusions()), /Demand collision/);
  const selfLeak = structuredClone(cases); selfLeak[0].finalDays[0].seed = selfLeak[0].feedbackDays[0].seed;
  assert.throws(() => validateFreshCases(selfLeak, exclusions()), /Demand collision/);
  const tooEasy = structuredClone(cases); tooEasy[0].feedbackDays[0].count = 1;
  assert.throws(() => validateFreshCases(tooEasy, exclusions()), /invalid count/);
  const profile = structuredClone(cases); profile[0].feedbackDays[0].profile = "fragile";
  assert.throws(() => validateFreshCases(profile, exclusions()), /four fixed profiles/);
});
