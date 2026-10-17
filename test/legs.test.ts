import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { legsAt, moved, possibleLegs } from "../src/agents/legs.ts";
import { simulate } from "../src/sim/engine.ts";
import { scenariosFor } from "../src/sim/scenarios.ts";

const champ = JSON.parse(readFileSync("recorded/live-a-7/replay.json", "utf8")).improved.layout;

test("ruler lists the legs the simulator can route, with simulator distances", () => {
  const legs = possibleLegs(champ);
  assert.deepEqual(legs.find((l) => l.from === "sort-1" && l.to === "pack-B"), { from: "sort-1", to: "pack-B", cells: 15 });
  assert.deepEqual(legs.find((l) => l.from === "pack-B" && l.to === "ship-B"), { from: "pack-B", to: "ship-B", cells: 4 });
  assert.equal(legs[0].cells, Math.max(...legs.map((l) => l.cells)));
  // Every leg a package actually traveled on a training day is one the ruler lists, with the same length.
  const known = new Map(legs.map((l) => [`${l.from}>${l.to}`, l.cells]));
  for (const t of simulate(champ, scenariosFor("train")[0]).trace) {
    for (const leg of t.legs) assert.equal(known.get(`${leg.from}>${leg.to}`), leg.cells);
  }
});

test("candidate cells report one station's in and out legs", () => {
  const [wall, inland] = legsAt(champ, "pack-B", [{ x: 0, y: 9 }, { x: 6, y: 4 }]);
  assert.deepEqual(wall.legs.map((l) => l.cells).sort((a, b) => a - b), [9, 14]);
  assert.deepEqual(inland.legs.map((l) => l.cells).sort((a, b) => a - b), [9, 10]);
  assert.equal(inland.longest, 10);
  assert.equal(moved(champ, "pack-B", 6, 4).stations.find((s) => s.id === "pack-B")?.x, 6);
  assert.equal(champ.stations.find((s: { id: string }) => s.id === "pack-B").x, 0, "original layout untouched");
});

test("measure_legs tool flags invalid cells and stops at its budget", async () => {
  const { rulerTool } = await import("../src/agents/designer.ts");
  const { loadTaskA } = await import("../src/tasks/task.ts");
  const tool = rulerTool(loadTaskA(), 1, { n: 0 });
  const out = tool.execute({ layout: champ, station: "pack-B", cells: [{ x: 6, y: 4 }, { x: 12, y: 7 }] }) as any;
  assert.equal(out.legs[0], "sort-1->pack-B 15");
  assert.deepEqual(out.candidates[0], { cell: [6, 4], valid: true, legs: ["pack-B->ship-B 10", "sort-1->pack-B 9"], longest: 10 });
  assert.equal(out.candidates[1].valid, false, "on top of the sorter");
  assert.match(String((tool.execute({ layout: champ }) as any).error), /ruler uses spent/);
});
