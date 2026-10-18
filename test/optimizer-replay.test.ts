import assert from "node:assert/strict";
import { test } from "node:test";
import { makeScenario } from "../src/sim/scenarios.ts";
import { graderHash } from "../src/sim/version.ts";
import { buildingHash, generateBuilding, layoutHash } from "../src/training/generate.ts";
import { applyAction, measureLayout } from "../src/training/optimizer.ts";
import { legalMoveActions, type OptimizerCase } from "../src/training/optimizer-data.ts";
import { summarizeOptimizerResults } from "../src/training/optimizer-evaluate.ts";
import { buildOptimizerReplays, type OptimizerSavedReport } from "../src/training/optimizer-replay.ts";

function fixture() {
  const cases: OptimizerCase[] = [], states: OptimizerSavedReport["cases"] = [];
  for (let i = 0; i < 3; i++) {
    const id = `replay-test-${i + 1}`, task = generateBuilding(20271000 + i, id);
    const days = (offset: number) => (["normal", "peak", "fragile", "skewed"] as const).map((profile, j) => ({ seed: 670_000_000 + i * 100 + offset + j, profile, count: 100 }));
    const item: OptimizerCase = { id, split: "test", buildingId: id, buildingHash: buildingHash(task), geometrySeed: 20271000 + i, initialLayoutHash: layoutHash(task.initial), task, initial: task.initial, feedbackDays: days(0), finalDays: days(4) };
    cases.push(item);
    const initial = measureLayout(task, item.initial, item.finalDays);
    const choices = legalMoveActions(task, item.initial, 847 + i, 100).map(action => {
      const layout = applyAction(task, item.initial, action);
      return { layout, final: measureLayout(task, layout, item.finalDays) };
    });
    const chosen = i === 1 ? { layout: item.initial, final: initial } : choices.find(choice => i === 0 ? choice.final.objective! < initial.objective! : choice.final.objective! > initial.objective!);
    assert.ok(chosen, "Fixture has the requested win or loss");
    for (const arm of ["base", "tuned", "random"] as const) {
      const layout = arm === "tuned" ? chosen.layout : item.initial;
      states.push({ arm, caseId: id, layout, feedback: measureLayout(task, layout, item.feedbackDays), previousAttempts: [], status: "complete", attemptedProposals: 3, acceptedMoves: arm === "tuned" && i !== 1 ? 1 : 0, invalidActions: 0, reason: null, initialFinal: initial, championFinal: arm === "tuned" ? chosen.final : initial });
    }
  }
  const budget = { offeredProposals: 9, attemptedProposals: 9, modelCalls: 9, acceptedMoves: 0, invalidActions: 0, stops: 0, knownTokens: 100, reservedUnknownTokens: 0, simulations: 100, layoutEvaluations: 25 };
  const summary = summarizeOptimizerResults(cases, states, { base: budget, tuned: { ...budget, acceptedMoves: 2 }, random: { ...budget, modelCalls: 0, knownTokens: 0 } });
  const report: OptimizerSavedReport = { schemaVersion: 1, completed: true, stopped: null, planHash: "fixture", ...summary, cases: states };
  return { cases, report };
}
const buildOptions = () => ({ createdAt: "2026-10-17T00:00:00.000Z", graderHash: graderHash() });

test("optimizer replays retain wins, losses and ties with an all-case median default", () => {
  const { cases, report } = fixture();
  const result = buildOptimizerReplays(report, cases, buildOptions());
  assert.equal(result.catalog.cases.length, 3);
  assert.equal(result.replays.size, 12);
  assert.deepEqual(result.catalog.cases.map(item => item.comparison.outcome), ["tuned", "tie", "base"]);
  assert.equal(result.catalog.defaultCaseId, "replay-test-2");
  assert.equal(result.catalog.defaultProfile, "normal");
  assert.deepEqual(result.catalog.pairedWins, { base: 1, tuned: 1, ties: 1 });
  assert.ok(result.catalog.metricsScope.includes("four held-out"));
  for (const item of result.catalog.cases) assert.deepEqual(item.initialLayout, cases.find(testCase => testCase.id === item.id)!.initial);
});

test("each trace uses identical package demand and matches saved per-day metrics exactly", () => {
  const { cases, report } = fixture();
  const result = buildOptimizerReplays(report, cases, buildOptions());
  for (const replay of result.replays.values()) {
    const item = cases.find(testCase => testCase.id === replay.optimizer.caseId)!;
    const day = item.finalDays.find(candidate => candidate.seed === replay.scenario.seed)!;
    const demand = makeScenario(day.seed, day.profile, day.count);
    for (const [arm, side] of [["base", replay.baseline], ["tuned", replay.improved]] as const) {
      const saved = report.cases.find(state => state.caseId === item.id && state.arm === arm)!.championFinal!.days.find(candidate => candidate.seed === day.seed)!;
      assert.deepEqual(side.result.scenario, replay.scenario);
      assert.deepEqual(side.result.metrics, saved.metrics);
      assert.deepEqual(side.result.trace.map(pkg => ({ id: pkg.id, arrival: pkg.arrival, zone: pkg.zone, size: pkg.size, fragile: pkg.fragile })), demand.packages.map(pkg => ({ id: pkg.id, arrival: pkg.arrival, zone: pkg.zone, size: pkg.size, fragile: pkg.fragile })));
    }
    assert.equal(replay.optimizer.scope, "one-final-demand-day");
    assert.equal(replay.optimizer.aggregateScope, "four-final-demand-days");
  }
});

test("modified saved metrics, aggregate results or missing factories fail closed", () => {
  const { cases, report } = fixture();
  const changedDay = structuredClone(report);
  changedDay.cases[0].championFinal!.days[0].metrics.damaged++;
  assert.throws(() => buildOptimizerReplays(changedDay, cases, buildOptions()), /Saved metric mismatch/);
  const changedAggregate = structuredClone(report);
  changedAggregate.overall.tuned.meanFinalObjective! += 1;
  assert.throws(() => buildOptimizerReplays(changedAggregate, cases, buildOptions()), /summary\/overall/);
  assert.throws(() => buildOptimizerReplays(report, cases.slice(1), buildOptions()), /every evaluated factory/);
  assert.throws(() => buildOptimizerReplays(report, cases, { ...buildOptions(), graderHash: "wrong" }), /Grader hash/);
});
