import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rng } from "../sim/scenarios.ts";
import type { Layout } from "../sim/types.ts";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import { FACTORIES, loadTask, type FactoryId, type Task } from "../tasks/task.ts";
import type { DemandDay } from "./critic.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "./generate.ts";
import { applyAction, betterCandidate, measureLayout, optimizerMessages, OPTIMIZER_PROMPT_PROFILE, type OptimizerAction, type OptimizerAttempt, type OptimizerMeasurement } from "./optimizer.ts";

export interface OptimizerCase {
  id: string;
  split: "test";
  buildingId: string;
  buildingHash: string;
  geometrySeed: number;
  initialLayoutHash: string;
  task: Task;
  initial: Layout;
  feedbackDays: DemandDay[];
  finalDays: DemandDay[];
}
export interface OptimizerRow {
  id: string;
  split: "train" | "validation";
  buildingId: string;
  buildingHash: string;
  geometrySeed: number;
  trajectory: number;
  trajectoryStep: number;
  previousAttempts: OptimizerAttempt[];
  task: Task;
  before: Layout;
  action: OptimizerAction;
  after: Layout;
  beforeHash: string;
  afterHash: string;
  feedbackDays: DemandDay[];
  gateDays: DemandDay[];
  feedback: { before: OptimizerMeasurement; after: OptimizerMeasurement };
  gate: { before: OptimizerMeasurement; after: OptimizerMeasurement };
  labelReason: "verified-improving-move" | "bounded-search-exhausted";
  search: { seed: number; candidates: number; selection: "best-feedback-then-single-independent-gate" | "no-improvement-in-bounded-feedback-search" };
}
export interface OptimizerDataOptions {
  seed: number;
  buildings: { train: number; validation: number; test: number };
  examplesPerBuilding: number;
  candidates: number;
}
export const DEFAULT_OPTIMIZER_DATA_OPTIONS: OptimizerDataOptions = { seed: 2026101702, buildings: { train: 60, validation: 10, test: 20 }, examplesPerBuilding: 20, candidates: 48 };

/** The first action is random too, allowing the evaluator to reuse this as its random baseline. */
export function legalMoveActions(task: Task, layout: Layout, seed: number, limit = 48): OptimizerAction[] {
  const random = rng(seed), integer = (n: number) => Math.floor(random() * n);
  const editable = layout.stations.filter(station => !task.fixed.includes(station.id) && ["sorter", "pack"].includes(station.kind));
  const actions: OptimizerAction[] = [], seen = new Set<string>();
  for (let attempt = 0; attempt < limit * 80 && actions.length < limit; attempt++) {
    const station = editable[integer(editable.length)];
    if (!station) break;
    const nearby = attempt % 3 !== 0;
    const x = nearby ? station.x + integer(9) - 4 : integer(layout.grid.w);
    const y = nearby ? station.y + integer(9) - 4 : integer(layout.grid.h);
    const action: OptimizerAction = { op: "move", stationId: station.id, x, y };
    const hash = JSON.stringify(action);
    if (seen.has(hash)) continue;
    seen.add(hash);
    try { applyAction(task, layout, action); actions.push(action); } catch { /* Rejection sampling only admits legal moves. */ }
  }
  return actions;
}

function perturb(task: Task, seed: number) {
  let layout = structuredClone(task.initial);
  const steps = 3 + seed % 8;
  for (let i = 0; i < steps; i++) {
    const [action] = legalMoveActions(task, layout, seed + i * 104729, 1);
    if (action) layout = applyAction(task, layout, action);
  }
  return layout;
}

function demand(firstSeed: number): DemandDay[] {
  return (["normal", "peak", "fragile", "skewed"] as const).map((profile, i) => ({ seed: firstSeed + i, profile, count: 100 }));
}

export function optimizerExclusions() {
  const buildings = new Set<string>(), layouts = new Set<string>();
  const sources: { path: string; sha256: string }[] = [];
  for (const id of Object.keys(FACTORIES) as FactoryId[]) {
    const task = loadTask(id);
    buildings.add(buildingHash(task)); layouts.add(layoutHash(task.initial));
    const path = `layouts/${FACTORIES[id]}`;
    sources.push({ path, sha256: contentHash(readFileSync(path, "utf8")) });
  }
  const path = "runs/finetune-data/critic-v1/raw-labels.jsonl";
  if (!existsSync(path)) throw new Error("Prior critic raw labels are required to exclude previously used buildings");
  const contents = readFileSync(path, "utf8");
  sources.push({ path, sha256: contentHash(contents) });
  for (const line of contents.trim().split("\n")) {
    const row = JSON.parse(line);
    // Recompute identity from geometry rather than trusting the prior manifest's hash.
    const layout = row.input.layout as Layout;
    const task: Task = { id: "prior-critic", initial: layout, goal: row.input.goal, fixed: row.input.constraints.fixedStations.map((station: { id: string }) => station.id), editable: { sorter: row.input.constraints.sorter, pack: row.input.constraints.pack }, capexCap: row.input.constraints.capexCap };
    buildings.add(buildingHash(task)); layouts.add(layoutHash(layout));
  }
  return { buildings, layouts, sources };
}

export function generateOptimizerData(options: OptimizerDataOptions = DEFAULT_OPTIMIZER_DATA_OPTIONS, onProgress?: (info: { split: string; buildings: number; examples: number; elapsedMs: number }) => void, exclusions = optimizerExclusions()) {
  if (!Number.isSafeInteger(options.seed) || options.seed < 1 || !Number.isInteger(options.examplesPerBuilding) || options.examplesPerBuilding < 1 || options.examplesPerBuilding > 100 || !Number.isInteger(options.candidates) || options.candidates < 1 || options.candidates > 64 || Object.values(options.buildings).some(count => !Number.isInteger(count) || count < 1 || count > 100)) throw new Error("Invalid optimizer dataset options");
  const started = Date.now(), frozenGrader = graderHash();
  const seenBuildings = new Set(exclusions.buildings), seenLayouts = new Set(exclusions.layouts);
  const rows: OptimizerRow[] = [], cases: OptimizerCase[] = [];
  const splitBuildingHashes: Record<string, string[]> = { train: [], validation: [], test: [] };
  const splitDemandSeeds: Record<string, number[]> = { train: [], validation: [], test: [] };
  let simulatorCalls = 0, rejectedGates = 0, rejectedSearches = 0;
  for (const [splitIndex, split] of (["train", "validation", "test"] as const).entries()) {
    for (let i = 0; i < options.buildings[split]; i++) {
      const buildingId = `optimizer-${split}-building-${i + 1}`;
      let geometrySeed = options.seed + splitIndex * 1_000_000 + i * 1009;
      let task = generateBuilding(geometrySeed, buildingId);
      for (let attempt = 0; seenBuildings.has(buildingHash(task)); attempt++) {
        if (attempt > 10000) throw new Error("Could not generate a fresh building");
        task = generateBuilding(++geometrySeed, buildingId);
      }
      const geometryHash = buildingHash(task);
      seenBuildings.add(geometryHash); splitBuildingHashes[split].push(geometryHash);
      const dayBase = 100_000_000 + splitIndex * 100_000_000 + i * 100_000;
      if (split === "test") {
        const initial = perturb(task, geometrySeed + 90_001);
        const initialLayoutHash = layoutHash(initial);
        if (seenLayouts.has(initialLayoutHash)) throw new Error("Held-out initial layout overlaps earlier data");
        seenLayouts.add(initialLayoutHash);
        const feedbackDays = demand(dayBase), finalDays = demand(dayBase + 4);
        splitDemandSeeds.test.push(...feedbackDays.map(day => day.seed), ...finalDays.map(day => day.seed));
        cases.push({ id: buildingId, split, buildingId, buildingHash: geometryHash, geometrySeed, initialLayoutHash, task, initial, feedbackDays, finalDays });
        continue;
      }
      let accepted = 0, trajectory = 0, trajectoryStep = 0, stopLabels = 0;
      let previousAttempts: OptimizerAttempt[] = [];
      let current = perturb(task, geometrySeed + 10_000);
      for (let attempt = 0; accepted < options.examplesPerBuilding; attempt++) {
        if (attempt >= options.examplesPerBuilding * 100) throw new Error(`Too few improving transitions for ${buildingId}`);
        const searchSeed = geometrySeed + 10_000 + attempt * 101;
        if (trajectoryStep >= 3 || trajectoryStep < 0) { current = perturb(task, searchSeed); trajectoryStep = 0; trajectory++; previousAttempts = []; }
        const beforeHash = layoutHash(current);
        if (trajectoryStep === 0 && seenLayouts.has(beforeHash)) { trajectoryStep = -1; continue; }
        const feedbackDays = demand(dayBase + attempt * 8), gateDays = demand(dayBase + attempt * 8 + 4);
        const before = measureLayout(task, current, feedbackDays); simulatorCalls += 4;
        const actions = legalMoveActions(task, current, searchSeed, options.candidates);
        let best: { action: OptimizerAction; after: Layout; measured: OptimizerMeasurement } | undefined;
        for (const action of actions) {
          const after = applyAction(task, current, action);
          const measured = measureLayout(task, after, feedbackDays); simulatorCalls += 4;
          if (betterCandidate(before, measured) && (!best || measured.objective! < best.measured.objective!)) best = { action, after, measured };
        }
        if (!best) {
          rejectedSearches++;
          if (stopLabels < Math.floor(options.examplesPerBuilding * 0.1) && actions.length === options.candidates) {
            const gateBefore = measureLayout(task, current, gateDays); simulatorCalls += 4;
            rows.push({ id: `${buildingId}-example-${++accepted}`, split, buildingId, buildingHash: geometryHash, geometrySeed, trajectory, trajectoryStep, previousAttempts: structuredClone(previousAttempts), task, before: current, action: { op: "stop" }, after: structuredClone(current), beforeHash, afterHash: beforeHash, feedbackDays, gateDays, feedback: { before, after: structuredClone(before) }, gate: { before: gateBefore, after: structuredClone(gateBefore) }, labelReason: "bounded-search-exhausted", search: { seed: searchSeed, candidates: actions.length, selection: "no-improvement-in-bounded-feedback-search" } });
            seenLayouts.add(beforeHash); stopLabels++;
            splitDemandSeeds[split].push(...feedbackDays.map(day => day.seed), ...gateDays.map(day => day.seed));
          }
          trajectoryStep = -1; continue;
        }
        if (seenLayouts.has(layoutHash(best.after))) { trajectoryStep = -1; continue; }
        const gateBefore = measureLayout(task, current, gateDays), gateAfter = measureLayout(task, best.after, gateDays); simulatorCalls += 8;
        if (!betterCandidate(gateBefore, gateAfter)) { rejectedGates++; trajectoryStep = -1; continue; }
        const afterHash = layoutHash(best.after);
        const row: OptimizerRow = { id: `${buildingId}-example-${++accepted}`, split, buildingId, buildingHash: geometryHash, geometrySeed, trajectory, trajectoryStep, previousAttempts: structuredClone(previousAttempts), task, before: current, action: best.action, after: best.after, beforeHash, afterHash, feedbackDays, gateDays, feedback: { before, after: best.measured }, gate: { before: gateBefore, after: gateAfter }, labelReason: "verified-improving-move", search: { seed: searchSeed, candidates: actions.length, selection: "best-feedback-then-single-independent-gate" } };
        rows.push(row); seenLayouts.add(beforeHash); seenLayouts.add(afterHash);
        splitDemandSeeds[split].push(...feedbackDays.map(day => day.seed), ...gateDays.map(day => day.seed));
        current = best.after; trajectoryStep++;
        previousAttempts.push({ action: best.action, status: "accepted", reason: "Improved measured objective and preserved passed checks", feedback: best.measured });
      }
      onProgress?.({ split, buildings: i + 1, examples: rows.filter(row => row.split === split).length, elapsedMs: Date.now() - started });
    }
  }
  if (graderHash() !== frozenGrader) throw new Error("Grader changed during optimizer generation");
  return { rows, cases, exclusions, splitBuildingHashes, splitDemandSeeds, elapsedMs: Date.now() - started, simulatorCalls, rejectedGates, rejectedSearches, graderHash: frozenGrader };
}

export function optimizerChatExample(row: OptimizerRow) {
  return { messages: [...optimizerMessages(row.task, row.before, row.feedback.before, row.previousAttempts), { role: "assistant" as const, content: JSON.stringify(row.action) }] };
}

export function exportOptimizerData(outputDirectory: string, options: OptimizerDataOptions = DEFAULT_OPTIMIZER_DATA_OPTIONS, onProgress?: Parameters<typeof generateOptimizerData>[1], exclusions?: ReturnType<typeof optimizerExclusions>) {
  const output = resolve(outputDirectory), allowed = resolve("runs/optimizer-data");
  if (!output.startsWith(`${allowed}/`) || existsSync(output)) throw new Error("Output must be a new directory inside runs/optimizer-data/");
  const sourcePaths = ["src/training/optimizer.ts", "src/training/optimizer-data.ts", "src/training/generate.ts", "scripts/prepare-optimizer.ts", "src/tasks/task.ts"];
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, contentHash(readFileSync(path, "utf8"))]));
  const generated = generateOptimizerData(options, onProgress, exclusions);
  for (const [path, hash] of Object.entries(sourceHashes)) if (contentHash(readFileSync(path, "utf8")) !== hash) throw new Error(`Source changed during dataset generation: ${path}`);
  mkdirSync(output, { recursive: true });
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const write = (name: string, rows: unknown[]) => {
    const contents = rows.map(row => JSON.stringify(row)).join("\n") + "\n";
    writeFileSync(join(output, name), contents, { flag: "wx" }); files[name] = { sha256: contentHash(contents), bytes: Buffer.byteLength(contents) };
  };
  for (const split of ["train", "validation"] as const) write(`${split}.jsonl`, generated.rows.filter(row => row.split === split).map(optimizerChatExample));
  write("raw-transitions.jsonl", generated.rows);
  write("test-factories.jsonl", generated.cases);
  const manifest = {
    schemaVersion: 1, task: "single-station-move-factory-optimizer", taskProfile: "optimizer", promptProfile: OPTIMIZER_PROMPT_PROFILE, simVersion: SIM_VERSION, graderHash: generated.graderHash, options, files,
    sourceHashes,
    labelSource: "Bounded legal-move search on four feedback days followed by exactly one selected-candidate check on four fresh gate days; no teacher model.",
    splitPolicy: "Whole buildings disjoint under rotation/reflection, excluding original A-G and every building in earlier critic raw data. Fresh nonoverlapping demand seeds. Test factories are unscored and unsearched.",
    evaluationPolicy: "Upload only train.jsonl and validation.jsonl. Seal test-factories.jsonl until checkpoint and evaluation budgets are frozen; score final days only after both model arms finish.",
    excludedBuildingHashes: [...generated.exclusions.buildings].sort(), exclusionSources: generated.exclusions.sources,
    splitBuildingHashes: generated.splitBuildingHashes, splitDemandSeeds: generated.splitDemandSeeds,
    stats: {
      train: { examples: generated.rows.filter(row => row.split === "train").length, buildings: options.buildings.train },
      validation: { examples: generated.rows.filter(row => row.split === "validation").length, buildings: options.buildings.validation },
      test: { examples: generated.cases.length, buildings: options.buildings.test, scored: false },
      trajectorySteps: Object.fromEntries([0, 1, 2].map(step => [step, generated.rows.filter(row => row.trajectoryStep === step).length])),
      stopLabels: generated.rows.filter(row => row.action.op === "stop").length, simulatorCalls: generated.simulatorCalls, rejectedGates: generated.rejectedGates, rejectedSearches: generated.rejectedSearches, elapsedMs: generated.elapsedMs,
    },
    limitations: "Move-only local optimization on synthetic rectangular factories. No machine additions, deletions, policy edits or global optimum labels. Stop means only that none of the bounded sampled candidates improved feedback, never global optimality. Stop labels are capped at 10% per building. Test results, not training loss, determine usefulness.",
  };
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}
