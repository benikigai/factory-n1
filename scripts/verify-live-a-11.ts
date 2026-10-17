import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { ReplayBundle } from "../src/replay.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { simulate } from "../src/sim/engine.ts";
import { evaluate, summarize } from "../src/sim/evaluate.ts";
import { makeScenario } from "../src/sim/scenarios.ts";
import type { Layout } from "../src/sim/types.ts";
import { graderHash } from "../src/sim/version.ts";

const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const dir = "recorded/live-a-11";
const champion = load<Layout>(`${dir}/champion.json`);
const replay = load<ReplayBundle>(`${dir}/replay.json`);
const summary = load<{ graderHash: string; champion: { train: number; select: number; dodSelect: boolean }; baseline: { train: number; select: number } }>(`${dir}/summary.json`);
const grader = graderHash();
assert.equal(grader, summary.graderHash);
assert.equal(grader, replay.graderHash);
assert.deepEqual(champion, replay.improved.layout);
const splits = {} as Record<"train" | "select", ReturnType<typeof summarize>>;
for (const [split, expected] of [["train", 3345.5], ["select", 3283.44]] as const) {
  const evaluated = evaluate(champion, split, DEFAULT_DOD);
  assert.equal(evaluated.valid, true);
  assert.equal(evaluated.objective, expected);
  assert.equal(evaluated.objective, summary.champion[split]);
  assert.equal(evaluated.dod?.passed, true);
  assert.equal(evaluate(replay.baseline.layout, split, DEFAULT_DOD).objective, summary.baseline[split]);
  for (const { metrics } of evaluated.results) {
    assert.equal(metrics.shipped, 100);
    assert.equal(metrics.unshipped, 0);
    assert.equal(metrics.missorts, 0);
    assert.equal(metrics.damaged, 0);
    assert.ok(metrics.makespan < 1500);
  }
  splits[split] = summarize(evaluated);
}
assert.equal(summary.champion.dodSelect, true);
const profile = replay.scenario.profile;
assert.ok(profile === "normal" || profile === "peak" || profile === "fragile" || profile === "skewed");
const scenario = makeScenario(replay.scenario.seed, profile);
assert.equal(scenario.id, replay.scenario.id);
for (const side of ["baseline", "improved"] as const) {
  const regenerated = simulate(replay[side].layout, scenario);
  assert.deepEqual(regenerated, replay[side].result, `${side} replay differs from the frozen simulator`);
  replay[side].result = regenerated;
}
// Regenerate the public replay only after the saved result passed exact comparison.
writeFileSync(`${dir}/replay.json`, JSON.stringify(replay));
const previous = load<Layout>("recorded/live-a-7/champion.json");
assert.equal(champion.stations.length, previous.stations.length);
const stationChanges = champion.stations.filter(station => {
  const old = previous.stations.find(s => s.id === station.id);
  return JSON.stringify(station) !== JSON.stringify(old);
}).map(station => ({ id: station.id, before: previous.stations.find(s => s.id === station.id), after: station }));
assert.equal(stationChanges.length, 1);
assert.equal(stationChanges[0].id, "pack-B");
const proof = {
  verifiedAt: new Date().toISOString(), runId: "live-a-11", graderHash: grader,
  finalSplitUsed: false, scope: "6 train + 9 select development scenarios; final split remains locked",
  splits,
  replay: {
    scenario: replay.scenario, baseline: replay.baseline.result.metrics, improved: replay.improved.result.metrics,
    regeneratedDeepEqual: true, sha256: createHash("sha256").update(readFileSync(`${dir}/replay.json`)).digest("hex"),
  },
  stationChanges,
};
writeFileSync("docs/evidence/independent-verification-live-a-11.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ train: splits.train.objective, select: splits.select.objective, goalPassed: true, developmentDays: 15, replayRegeneratedDeepEqual: true, graderHash: grader }));
