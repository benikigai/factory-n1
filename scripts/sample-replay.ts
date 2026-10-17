// Dev fixture for the 3D viewer: baseline vs the code heuristic on one real scenario.
// Labeled synthetic (no model calls). Never use this as the agent-improved demo result.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { simulate } from "../src/sim/engine.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { makeScenario } from "../src/sim/scenarios.ts";
import { SIM_VERSION, graderHash } from "../src/sim/version.ts";
import type { Layout } from "../src/sim/types.ts";
import type { ReplayBundle, ReplaySide } from "../src/replay.ts";

const baseline = JSON.parse(readFileSync("layouts/baseline.json", "utf8")) as Layout;
const heuristic: Layout = {
  ...baseline,
  name: "code-heuristic-size-coverage",
  stations: baseline.stations.map((s) => (s.kind === "pack" ? { ...s, sizes: ["S", "M", "L"] } : s)),
};
const scenario = makeScenario(2, "peak");
const side = (label: string, layout: Layout): ReplaySide => {
  const train = evaluate(layout, "train", DEFAULT_DOD);
  const select = evaluate(layout, "select", DEFAULT_DOD);
  return {
    label,
    layout,
    result: simulate(layout, scenario),
    train: { objective: train.objective, dodPassed: train.dod!.passed },
    select: { objective: select.objective, dodPassed: select.dod!.passed },
  };
};
const b = side("Gen-0 baseline", baseline);
const h = side("SYNTHETIC stand-in: code heuristic", heuristic);
const bundle: ReplayBundle = {
  runId: "sample",
  mode: "synthetic",
  createdAt: new Date().toISOString(),
  simVersion: SIM_VERSION,
  graderHash: graderHash(),
  task: { id: "factory-a", goal: DEFAULT_DOD.goal },
  scenario: { id: scenario.id, seed: scenario.seed, profile: scenario.profile },
  baseline: b,
  improved: h,
  comparators: [{ label: "Code heuristic (size coverage)", train: h.train.objective, select: h.select.objective }],
  accepted: [
    {
      gen: 1, candidateId: "g1-coverage", designer: "coverage", rationale: "SYNTHETIC FIXTURE: let both pack stations accept large boxes.",
      selectBefore: b.select.objective, selectAfter: h.select.objective,
      edits: [
        { edit: "pack-1 sizes S,M -> S,M,L", deltaAlone: -2400 },
        { edit: "pack-2 sizes S,M -> S,M,L", deltaAlone: -2350 },
      ],
      appliedLessons: ["L-ext-1"],
    },
  ],
  rejected: [
    {
      gen: 1, candidateId: "g1-flow", designer: "flow", rationale: "SYNTHETIC FIXTURE: move the receiving dock inward.",
      reason: "invalid: recv-1 is a dock and must sit on the outer wall", trainObjective: null,
      errors: ["recv-1 is a dock and must sit on the outer wall"], layout: null,
    },
  ],
  lessons: [
    {
      id: "L-ext-1", kind: "external", text: "SYNTHETIC FIXTURE: match pack-station capability to the incoming size mix.",
      sources: [{ url: "https://example.com/fixture", title: "Fixture source (not a real citation)" }],
      posterior: { helped: 1, trials: 1, mean: 0.67 },
    },
  ],
  curve: [
    { gen: 0, championSelect: b.select.objective, candidates: [] },
    { gen: 1, championSelect: h.select.objective, candidates: [{ id: "g1-coverage", train: h.train.objective, accepted: true }, { id: "g1-flow", train: null, accepted: false }] },
  ],
  usage: { calls: 0, usd: 0, searches: 0, searchUsd: 0 },
};
mkdirSync("runs/sample", { recursive: true });
writeFileSync("runs/sample/replay.json", JSON.stringify(bundle));
console.log(`runs/sample/replay.json: baseline select ${b.select.objective} -> stand-in ${h.select.objective}; ${b.result.trace.length} packages`);
