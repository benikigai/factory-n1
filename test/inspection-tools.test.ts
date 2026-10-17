import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInspectionTools } from "../src/inspection/tools.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { graderHash } from "../src/sim/version.ts";
import { loadTaskA } from "../src/tasks/task.ts";
import type { Layout } from "../src/sim/types.ts";

const task = loadTaskA();
const champion = JSON.parse(readFileSync(new URL("../recorded/live-a-11/champion.json", import.meta.url), "utf8")) as Layout;
const create = () => createInspectionTools({ task, baseline: task.initial, champion, runId: "live-a-11", expectedGraderHash: graderHash() });
const invoke = (name: string, input: unknown) => create().find(tool => tool.definition.function.name === name)!.execute(input) as any;

test("inspection tools measure real station distances and report unknown ids without inventing a route", () => {
  const result = invoke("measure_legs", { layout: "champion", legs: [{ from: "sort-1", to: "pack-B" }, { from: "pack-B", to: "ship-B" }, { from: "missing", to: "ship-B" }] });
  assert.deepEqual(result.legs.map((leg: any) => leg.cells ?? leg.error), [11, 8, "unknown_station"]);
  assert.deepEqual(result.legs[0].toPosition, { x: 3, y: 5 });
  assert.equal(result.evidence.graderHash, graderHash());
  assert.match(result.method, /Manhattan/);
  assert.match(result.evidence.scope, /no test or final split/);
});

test("inspection comparison agrees with unchanged evaluator on all select days", () => {
  const result = invoke("compare_layouts", { split: "select" });
  const expected = evaluate(champion, "select", DEFAULT_DOD);
  assert.equal(result.champion.objective, expected.objective);
  assert.equal(result.baseline.objective, 18061.11);
  assert.equal(result.champion.objective, 3283.44);
  assert.equal(result.champion.scenarioCount, 9);
  assert.equal(result.champion.dodPassed, true);
  assert.equal(result.champion.totals.damaged, 0);
  assert.equal(result.champion.totals.shipped, 900);
  assert.deepEqual(result.champion.scenarios.map((scenario: any) => scenario.id), expected.results.map(result => result.scenario.id));
  assert.equal(result.deltaMean.objective, -14777.67);
  assert.match(result.interpretation, /does not establish causal attribution/);
});

test("inspection rejects holdouts, arbitrary layouts, excess arguments and oversized measurement requests", () => {
  for (const tool of create()) {
    const name = tool.definition.function.name;
    if (name === "compare_layouts") {
      for (const split of ["final", "test", "FINAL", null]) {
        assert.throws(() => tool.parse({ split }));
        assert.throws(() => tool.execute({ split }));
      }
    }
    if (name === "evaluate_layout") {
      assert.throws(() => tool.execute({ layout: "champion", split: "final" }));
      assert.throws(() => tool.parse({ layout: champion, split: "train" }));
      assert.throws(() => tool.parse({ layout: "champion", split: "train", extra: true }));
    }
    if (name === "measure_legs") {
      assert.throws(() => tool.parse({ layout: "champion", legs: [] }));
      assert.throws(() => tool.parse({ layout: "champion", legs: Array.from({ length: 17 }, () => ({ from: "sort-1", to: "pack-B" })) }));
      assert.throws(() => tool.parse({ layout: "champion", legs: [{ from: "sort-1", to: "pack-B", code: "anything" }] }));
    }
  }
});

test("strict tool schemas have no open top-level or nested argument objects", () => {
  for (const tool of create()) {
    assert.equal(tool.definition.function.strict, true);
    const schema = tool.definition.function.parameters as any;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    if (schema.properties.legs) assert.equal(schema.properties.legs.items.additionalProperties, false);
  }
});

test("inspection owns immutable snapshots and keeps cached evaluation results isolated from callers", () => {
  const baselineCopy = structuredClone(task.initial), championCopy = structuredClone(champion);
  const tools = createInspectionTools({ task, baseline: baselineCopy, champion: championCopy, runId: "live-a-11" });
  const layoutTool = tools.find(tool => tool.definition.function.name === "get_layout")!;
  const evaluateTool = tools.find(tool => tool.definition.function.name === "evaluate_layout")!;
  championCopy.stations[0].x = 999;
  const first = layoutTool.execute({ layout: "champion" }) as any;
  assert.equal(first.layout.stations[0].x, 0);
  first.layout.stations[0].x = 888;
  assert.equal((layoutTool.execute({ layout: "champion" }) as any).layout.stations[0].x, 0);
  const scored = evaluateTool.execute({ layout: "champion", split: "train" }) as any;
  scored.evaluation.scenarios[0].damaged = 999;
  assert.equal((evaluateTool.execute({ layout: "champion", split: "train" }) as any).evaluation.scenarios[0].damaged, 0);
  assert.deepEqual(baselineCopy, task.initial);
});

test("inspection refuses mismatched grader and invalid task layouts at setup", () => {
  assert.throws(() => createInspectionTools({ task, baseline: task.initial, champion, runId: "live-a-11", expectedGraderHash: "different" }), /grader changed/);
  const changedDock = structuredClone(champion);
  changedDock.stations[0].x = 2;
  assert.throws(() => createInspectionTools({ task, baseline: task.initial, champion: changedDock, runId: "live-a-11" }), /fixed dock/);
});
