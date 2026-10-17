import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { FACTORIES, loadTask, validateForTask, type FactoryId } from "../src/tasks/task.ts";

test("all five factories load, satisfy their own task rules, and start out failing the goal", () => {
  for (const id of Object.keys(FACTORIES) as FactoryId[]) {
    const t = loadTask(id);
    assert.deepEqual(validateForTask(t.initial, t), [], id);
    assert.ok(t.fixed.every((f) => t.initial.stations.find((s) => s.id === f)!.kind !== "sorter"), `${id}: only docks are fixed`);
    assert.equal(evaluate(t.initial, "train", DEFAULT_DOD).dod!.passed, false, `${id} Gen-0 must fail`);
  }
});
