import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { SIM } from "../sim/config.ts";
import { distance } from "../sim/layout.ts";
import { SPLITS } from "../sim/scenarios.ts";
import type { Layout, Station } from "../sim/types.ts";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import { validateForTask, type Task } from "../tasks/task.ts";
import type { DemandDay } from "./critic.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "./generate.ts";
import { legalMoveActions, type OptimizerCase } from "./optimizer-data.ts";
import { applyAction, betterCandidate, measureLayout, optimizerMessages, OPTIMIZER_PROMPT_PROFILE, type OptimizerAction, type OptimizerAttempt, type OptimizerMeasurement } from "./optimizer.ts";

const sameXY = (a: Station, b: Station) => a.x === b.x && a.y === b.y;
const safeSpacing = (a: Station, b: Station) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= SIM.minSpacing;
const popcount = (value: number) => { let n = 0; while (value) { n += value & 1; value >>>= 1; } return n; };

export function transportEdges(layout: Layout) {
  const receiving = layout.stations.find(station => station.kind === "receiving")!;
  const sorter = layout.stations.find(station => station.kind === "sorter")!;
  const result = [{ from: receiving.id, to: sorter.id, cells: distance(receiving, sorter) }];
  for (const pack of layout.stations.filter(station => station.kind === "pack")) {
    result.push({ from: sorter.id, to: pack.id, cells: distance(sorter, pack) });
    for (const dock of layout.stations.filter(station => station.kind === "shipping" && station.zones?.some(zone => pack.zones?.includes(zone)))) result.push({ from: pack.id, to: dock.id, cells: distance(pack, dock) });
  }
  return result;
}

export interface GeometricEndpoint {
  feasible: boolean;
  layout: Layout | null;
  minimumChangedStations: number | null;
  edges: ReturnType<typeof transportEdges>;
  nodes: number;
  sorterTests: number;
  maskTests: number;
  lowerBudgetsExhausted: boolean;
}

/** Exhaustive endpoint search from the recorded geometric-feasibility proof; no model or final-day access. */
export function geometricEndpoint(task: Task, start: Layout, nodeLimit = 5_000_000): GeometricEndpoint {
  const errors = validateForTask(start, task);
  if (errors.length) throw new Error(`Invalid teacher input: ${errors.join("; ")}`);
  const fixed = start.stations.filter(station => task.fixed.includes(station.id));
  const receiving = fixed.find(station => station.kind === "receiving")!;
  const packs = start.stations.filter(station => station.kind === "pack");
  const oldSorter = start.stations.find(station => station.kind === "sorter")!;
  if (start.stations.filter(station => station.kind === "receiving").length !== 1 || start.stations.filter(station => station.kind === "sorter").length !== 1 || packs.length !== 6) throw new Error("Geometric teacher expects one receiving dock, one sorter and six packs");
  const points: { x: number; y: number }[] = [];
  for (let x = 0; x < start.grid.w; x++) for (let y = 0; y < start.grid.h; y++) points.push({ x, y });
  let nodes = 0, sorterTests = 0, maskTests = 0;
  const sorterInfo = points.map(xy => ({ ...oldSorter, ...xy })).filter(sorter => distance(sorter, receiving) <= SIM.fragileMaxLeg && fixed.every(dock => safeSpacing(sorter, dock))).map(sorter => {
    const domains = packs.map(pack => points.map(xy => ({ ...pack, ...xy })).filter(candidate => safeSpacing(candidate, sorter) && distance(candidate, sorter) <= SIM.fragileMaxLeg && fixed.every(dock => safeSpacing(candidate, dock)) && fixed.filter(dock => dock.kind === "shipping" && pack.zones?.some(zone => dock.zones?.includes(zone))).every(dock => distance(candidate, dock) <= SIM.fragileMaxLeg)));
    let required = 0;
    packs.forEach((pack, i) => { if (!domains[i].some(candidate => sameXY(candidate, pack))) required |= 1 << i; });
    return { sorter, domains, required, cost: Number(!sameXY(sorter, oldSorter)) };
  }).sort((a, b) => a.cost - b.cost || distance(a.sorter, oldSorter) - distance(b.sorter, oldSorter));
  for (let budget = 0; budget <= 7; budget++) for (const { sorter, domains, required, cost } of sorterInfo) {
    if (cost + popcount(required) > budget || domains.some(domain => !domain.length)) continue;
    sorterTests++;
    for (let mask = 0; mask < 1 << packs.length; mask++) {
      if ((mask & required) !== required || popcount(mask) + cost !== budget) continue;
      maskTests++;
      const chosen: (Station | undefined)[] = packs.map((pack, i) => mask & 1 << i ? undefined : pack);
      const todo = packs.map((_, i) => i).filter(i => mask & 1 << i);
      const domainsLeft = domains.map((list, i) => list.filter(candidate => !sameXY(candidate, packs[i]) && chosen.every(other => !other || safeSpacing(candidate, other))).sort((a, b) => {
        const cost = (pack: Station) => distance(sorter, pack) + fixed.filter(dock => dock.kind === "shipping" && pack.zones?.some(zone => dock.zones?.includes(zone))).reduce((sum, dock) => sum + distance(pack, dock), 0);
        return cost(a) - cost(b) || distance(a, packs[i]) - distance(b, packs[i]);
      }));
      const assign = (left: number[]): boolean => {
        if (++nodes > nodeLimit) throw new Error("Geometric teacher search limit reached; no infeasibility claim");
        if (!left.length) return true;
        const choices = left.map(i => ({ i, points: domainsLeft[i].filter(candidate => chosen.every(other => !other || safeSpacing(candidate, other))) })).sort((a, b) => a.points.length - b.points.length);
        const current = choices[0];
        for (const candidate of current.points) { chosen[current.i] = candidate; if (assign(left.filter(i => i !== current.i))) return true; }
        chosen[current.i] = undefined;
        return false;
      };
      if (assign(todo)) {
        const layout: Layout = { ...start, stations: start.stations.map(station => station.id === sorter.id ? sorter : chosen.find(pack => pack?.id === station.id) ?? station) };
        const edges = transportEdges(layout);
        if (validateForTask(layout, task).length || edges.some(edge => edge.cells > SIM.fragileMaxLeg)) throw new Error("Invalid geometric certificate");
        return { feasible: true, layout, minimumChangedStations: budget, edges, nodes, sorterTests, maskTests, lowerBudgetsExhausted: true };
      }
    }
  }
  return { feasible: false, layout: null, minimumChangedStations: null, edges: [], nodes, sorterTests, maskTests, lowerBudgetsExhausted: true };
}

/** This direct-path certificate explores only one minimum-change endpoint, not temporary parking moves. */
export function geometricTeacherPlan(task: Task, start: Layout, feedbackDays: DemandDay[], maxMoves = 12) {
  const endpoint = geometricEndpoint(task, start);
  let feedbackSimulationCalls = 0;
  if (!endpoint.layout) return { endpoint, actions: null, feedbackSimulationCalls, simulatorCalls: 0, testedStates: 0 };
  const actions: OptimizerAction[] = endpoint.layout.stations.filter(station => !task.fixed.includes(station.id) && !sameXY(station, start.stations.find(original => original.id === station.id)!)).map(station => ({ op: "move", stationId: station.id, x: station.x, y: station.y }));
  if (actions.length > maxMoves) return { endpoint, actions: null, feedbackSimulationCalls, simulatorCalls: 0, testedStates: 0 };
  const all = (1 << actions.length) - 1, failed = new Set<number>(), measurements = new Map<number, OptimizerMeasurement>();
  const measure = (mask: number, layout: Layout) => {
    if (!measurements.has(mask)) { measurements.set(mask, measureLayout(task, layout, feedbackDays)); feedbackSimulationCalls += feedbackDays.length; }
    return measurements.get(mask)!;
  };
  const walk = (mask: number, layout: Layout, path: OptimizerAction[]): OptimizerAction[] | null => {
    if (mask === all) return path;
    if (failed.has(mask)) return null;
    for (let i = 0; i < actions.length; i++) if (!(mask & 1 << i)) {
      let next: Layout;
      try { next = applyAction(task, layout, actions[i]); } catch { continue; }
      const nextMask = mask | 1 << i;
      if (!betterCandidate(measure(mask, layout), measure(nextMask, next))) continue;
      const pathResult = walk(nextMask, next, [...path, actions[i]]);
      if (pathResult) return pathResult;
    }
    failed.add(mask); return null;
  };
  const path = walk(0, start, []);
  return { endpoint, actions: path, feedbackSimulationCalls, simulatorCalls: feedbackSimulationCalls, testedStates: measurements.size };
}

export interface V2TrainingRow {
  id: string;
  split: "train" | "validation";
  buildingId: string;
  buildingHash: string;
  geometrySeed: number;
  trajectory: number;
  trajectoryStep: number;
  trajectoryLength: number;
  task: Task;
  before: Layout;
  action: OptimizerAction;
  after: Layout;
  beforeHash: string;
  afterHash: string;
  endpointHash: string;
  previousAttempts: OptimizerAttempt[];
  feedbackDays: DemandDay[];
  gateDays: DemandDay[];
  feedback: { before: OptimizerMeasurement; after: OptimizerMeasurement };
  gate: { before: OptimizerMeasurement; after: OptimizerMeasurement };
  labelReason: "verified-path-to-full-goal" | "verified-full-goal-stop";
}
export interface V2Options { seed: number; buildings: { train: number; validation: number; test: number } }
export const DEFAULT_V2_OPTIONS: V2Options = { seed: 1_370_100_001, buildings: { train: 60, validation: 10, test: 20 } };
export const V2_FIXTURE_SEED = 870_100_001;
export interface V2Exclusions { buildings: Set<string>; demands?: Set<number>; sources: { path: string; sha256: string }[] }
const profiles = ["normal", "peak", "fragile", "skewed"] as const;
const days = (seed: number): DemandDay[] => profiles.map((profile, i) => ({ seed: seed + i, profile, count: 100 }));

export function v2Exclusions() {
  const path = "runs/optimizer-data/v1/manifest.json", text = readFileSync(path, "utf8"), manifest = JSON.parse(text);
  const exploratoryPath = "runs/optimizer-v2-assessment/exploratory-probes.jsonl", exploratoryText = readFileSync(exploratoryPath, "utf8");
  const probes = exploratoryText.trim().split("\n").map(line => JSON.parse(line) as OptimizerCase);
  const criticPath = "runs/finetune-data/critic-v1/raw-labels.jsonl", criticText = readFileSync(criticPath, "utf8");
  const buildings = new Set<string>([...manifest.excludedBuildingHashes, ...Object.values(manifest.splitBuildingHashes).flat() as string[], ...probes.map(probe => probe.buildingHash)]);
  const demands = new Set<number>([...Object.values(manifest.splitDemandSeeds).flat() as number[], ...probes.flatMap(probe => [...probe.feedbackDays, ...probe.finalDays].map(day => day.seed)), ...criticText.trim().split("\n").flatMap(line => (JSON.parse(line).input.demand as DemandDay[]).map(day => day.seed)), ...Object.values(SPLITS).flat().map(day => day.seed)]);
  const sources = [{ path, sha256: contentHash(text) }, { path: exploratoryPath, sha256: contentHash(exploratoryText) }, { path: criticPath, sha256: contentHash(criticText) }];
  for (const developmentPath of ["runs/optimizer-data/v2-benchmark/manifest.json", "runs/optimizer-data/v2-consumed-development.json", "runs/optimizer-data/v2-fixture-exclusions.json"]) {
    if (!existsSync(developmentPath)) continue;
    const developmentText = readFileSync(developmentPath, "utf8"), data = JSON.parse(developmentText);
    for (const hash of data.buildingHashes ?? Object.values(data.splitBuildingHashes).flat()) buildings.add(hash as string);
    for (const seed of data.demandSeeds ?? Object.values(data.splitDemandSeeds).flat()) demands.add(seed as number);
    sources.push({ path: developmentPath, sha256: contentHash(developmentText) });
  }
  return { buildings, demands, sources };
}

function degradedPredecessor(task: Task, current: Layout, feedbackDays: DemandDay[], gateDays: DemandDay[], seed: number, desiredKind: "sorter" | "pack") {
  const afterFeedback = measureLayout(task, current, feedbackDays), afterGate = measureLayout(task, current, gateDays);
  for (let pass = 0; pass < 5; pass++) {
    const candidates = legalMoveActions(task, current, seed + pass * 104729, 64).sort((a, b) => {
      const kind = (action: OptimizerAction) => action.op === "move" ? current.stations.find(station => station.id === action.stationId)!.kind : "";
      return Number(kind(b) === desiredKind) - Number(kind(a) === desiredKind);
    });
    for (const action of candidates) {
      if (action.op !== "move") continue;
      const before = applyAction(task, current, action);
      const beforeFeedback = measureLayout(task, before, feedbackDays);
      if (!betterCandidate(beforeFeedback, afterFeedback)) continue;
      const beforeGate = measureLayout(task, before, gateDays);
      if (!betterCandidate(beforeGate, afterGate)) continue;
      const old = current.stations.find(station => station.id === action.stationId)!;
      return { before, action: { op: "move" as const, stationId: old.id, x: old.x, y: old.y }, after: current, feedback: { before: beforeFeedback, after: afterFeedback }, gate: { before: beforeGate, after: afterGate } };
    }
  }
  throw new Error("Could not construct a verified worsening predecessor");
}

function actualNegativeHistory(task: Task, before: Layout, measured: OptimizerMeasurement, demand: DemandDay[], seed: number, mode: "invalid" | "rejected"): OptimizerAttempt {
  if (mode === "rejected") {
    for (const action of legalMoveActions(task, before, seed, 64)) {
      const candidate = applyAction(task, before, action), feedback = measureLayout(task, candidate, demand);
      if (!betterCandidate(measured, feedback)) return { action, status: "rejected", reason: "Did not reduce the feedback objective while preserving every already-passed check", feedback };
    }
  }
  const editable = before.stations.filter(station => !task.fixed.includes(station.id));
  const station = editable[seed % editable.length], occupied = before.stations.find(other => other.id !== station.id)!;
  const action: OptimizerAction = { op: "move", stationId: station.id, x: occupied.x, y: occupied.y };
  try { applyAction(task, before, action); } catch (error) { return { action, status: "invalid", reason: error instanceof Error ? error.message : String(error) }; }
  throw new Error("Negative example must be genuinely invalid");
}

export function generateV2Data(options = DEFAULT_V2_OPTIONS, onProgress?: (progress: { split: string; buildings: number; examples: number; elapsedMs: number }) => void, exclusions: V2Exclusions = v2Exclusions()) {
  if (!Number.isSafeInteger(options.seed) || Object.values(options.buildings).some(count => !Number.isInteger(count) || count < 1 || count > 100)) throw new Error("Invalid v2 dataset options");
  const started = Date.now(), frozenGrader = graderHash(), seenBuildings = new Set(exclusions.buildings);
  const rows: V2TrainingRow[] = [], cases: OptimizerCase[] = [], certificates: { buildingId: string; certificate: GeometricEndpoint }[] = [];
  const splitBuildingHashes: Record<string, string[]> = { train: [], validation: [], test: [] }, splitDemandSeeds: Record<string, number[]> = { train: [], validation: [], test: [] };
  const registerDays = (split: string, demand: DemandDay[]) => {
    for (const day of demand) {
      if (exclusions.demands?.has(day.seed) || Object.values(splitDemandSeeds).some(seeds => seeds.includes(day.seed))) throw new Error("Demand seed overlaps a previous dataset or another curriculum episode");
      splitDemandSeeds[split].push(day.seed);
    }
  };
  let rejectedTrainingGeometries = 0, retriedTrajectories = 0, rejectedTrainingDemandDraws = 0;
  for (const [splitIndex, split] of (["train", "validation", "test"] as const).entries()) for (let i = 0; i < options.buildings[split]; i++) {
    if (Date.now() - started > 180_000) throw new Error("V2 generation exceeded three-minute preparation cap");
    const id = `optimizer-v2-${split}-building-${i + 1}`;
    let geometrySeed = options.seed + splitIndex * 1_000_000 + i * 1009;
    let task = generateBuilding(geometrySeed, id);
    while (seenBuildings.has(buildingHash(task))) task = generateBuilding(++geometrySeed, id);
    const dayBase = options.seed + 400_000_000 + splitIndex * 100_000_000 + i * 1_000_000;
    if (split === "test") {
      const hash = buildingHash(task); seenBuildings.add(hash); splitBuildingHashes.test.push(hash);
      let initial = structuredClone(task.initial);
      for (let k = 0; k < 3 + geometrySeed % 8; k++) {
        const action = legalMoveActions(task, initial, geometrySeed + k * 104729, 1)[0];
        if (action) initial = applyAction(task, initial, action);
      }
      const feedbackDays = days(dayBase), finalDays = days(dayBase + 4);
      registerDays("test", [...feedbackDays, ...finalDays]);
      cases.push({ id, split, buildingId: id, buildingHash: hash, geometrySeed, initialLayoutHash: layoutHash(initial), task, initial, feedbackDays, finalDays });
      continue;
    }
    let endpoint: GeometricEndpoint;
    const episodes: { feedbackDays: DemandDay[]; gateDays: DemandDay[] }[] = [];
    let demandCursor = dayBase;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 50 || Date.now() - started > 180_000) throw new Error("Could not find a full-goal curriculum endpoint within preparation cap");
      endpoint = geometricEndpoint(task, task.initial);
      episodes.length = 0;
      if (endpoint.layout) for (let trajectory = 0; trajectory < 10; trajectory++) {
        let accepted = false;
        for (let draw = 0; draw < 40; draw++) {
          const feedbackDays = days(demandCursor), gateDays = days(demandCursor + 4);
          demandCursor += 8;
          registerDays(split, [...feedbackDays, ...gateDays]);
          if (measureLayout(task, endpoint.layout, feedbackDays).goalMet && measureLayout(task, endpoint.layout, gateDays).goalMet) {
            episodes.push({ feedbackDays, gateDays }); accepted = true; break;
          }
          rejectedTrainingDemandDraws++;
        }
        if (!accepted) break;
      }
      if (episodes.length === 10) break;
      seenBuildings.add(buildingHash(task)); rejectedTrainingGeometries++;
      do { task = generateBuilding(++geometrySeed, id); } while (seenBuildings.has(buildingHash(task)));
    }
    const hash = buildingHash(task); seenBuildings.add(hash); splitBuildingHashes[split].push(hash);
    certificates.push({ buildingId: id, certificate: endpoint });
    const endpointLayout = endpoint.layout!, endpointHash = layoutHash(endpointLayout);
    let example = 0;
    for (let trajectory = 0; trajectory < 10; trajectory++) {
      const length = trajectory < 7 ? 1 : trajectory < 9 ? 6 : 0;
      const { feedbackDays, gateDays } = episodes[trajectory];
      const finalFeedback = measureLayout(task, endpointLayout, feedbackDays), finalGate = measureLayout(task, endpointLayout, gateDays);
      if (!finalFeedback.goalMet || !finalGate.goalMet) throw new Error(`Endpoint not full goal on curriculum days for ${id}`);
      const path: ReturnType<typeof degradedPredecessor>[] = [];
      for (let retry = 0; path.length < length; retry++) {
        if (retry === 20) throw new Error(`Could not construct a complete ${length}-step verified path for ${id}`);
        path.length = 0;
        let current = endpointLayout;
        try {
          for (let backwards = 0; backwards < length; backwards++) {
            const desiredKind = length === 1 ? trajectory % 2 === 0 ? "sorter" : "pack" : backwards % 3 === 0 ? "sorter" : "pack";
            const predecessor = degradedPredecessor(task, current, feedbackDays, gateDays, geometrySeed + trajectory * 7919 + backwards * 101 + retry * 104729, desiredKind);
            path.unshift(predecessor); current = predecessor.before;
          }
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Could not construct a verified worsening predecessor") throw error;
          retriedTrajectories++;
        }
      }
      if (!length) {
        const previousAttempts = [actualNegativeHistory(task, endpointLayout, finalFeedback, feedbackDays, geometrySeed + 90001, "rejected")];
        rows.push({ id: `${id}-example-${++example}`, split, buildingId: id, buildingHash: hash, geometrySeed, trajectory, trajectoryStep: 0, trajectoryLength: 0, task, before: endpointLayout, action: { op: "stop" }, after: endpointLayout, beforeHash: endpointHash, afterHash: endpointHash, endpointHash, previousAttempts, feedbackDays, gateDays, feedback: { before: finalFeedback, after: finalFeedback }, gate: { before: finalGate, after: finalGate }, labelReason: "verified-full-goal-stop" });
      }
      for (const [step, transition] of path.entries()) {
        let previousAttempts: OptimizerAttempt[];
        if (trajectory < 7 && trajectory % 3 === 0) previousAttempts = [];
        else if (step > 0 && step % 3 === 1) previousAttempts = [{ action: path[step - 1].action, status: "accepted", reason: "Improved measured objective and preserved passed checks", feedback: path[step - 1].feedback.after }];
        else previousAttempts = [actualNegativeHistory(task, transition.before, transition.feedback.before, feedbackDays, geometrySeed + trajectory * 101 + step, (example % 3 === 0) ? "invalid" : "rejected")];
        rows.push({ id: `${id}-example-${++example}`, split, buildingId: id, buildingHash: hash, geometrySeed, trajectory, trajectoryStep: step, trajectoryLength: length, task, ...transition, beforeHash: layoutHash(transition.before), afterHash: layoutHash(transition.after), endpointHash, previousAttempts, feedbackDays, gateDays, labelReason: "verified-path-to-full-goal" });
      }
    }
    if (example !== 20) throw new Error("Curriculum must provide twenty examples per building");
    onProgress?.({ split, buildings: i + 1, examples: rows.filter(row => row.split === split).length, elapsedMs: Date.now() - started });
  }
  if (graderHash() !== frozenGrader) throw new Error("Grader changed during v2 generation");
  return { rows, cases, certificates, splitBuildingHashes, splitDemandSeeds, exclusions, rejectedTrainingGeometries, rejectedTrainingDemandDraws, retriedTrajectories, consumedBuildingHashes: [...seenBuildings], graderHash: frozenGrader, elapsedMs: Date.now() - started };
}

export function exportV2Data(outputDirectory = "runs/optimizer-data/v2", options = DEFAULT_V2_OPTIONS, onProgress?: Parameters<typeof generateV2Data>[1], exclusions?: V2Exclusions) {
  const output = resolve(outputDirectory);
  if (!output.startsWith(resolve("runs/optimizer-data") + "/") || existsSync(output)) throw new Error("V2 output must be a new directory inside runs/optimizer-data");
  const sources = ["src/training/optimizer-v2-data.ts", "scripts/generate-optimizer-v2-data.ts", "src/training/optimizer.ts", "src/training/optimizer-data.ts", "src/training/generate.ts", "src/tasks/task.ts"];
  const sourceHashes = Object.fromEntries(sources.map(path => [path, contentHash(readFileSync(path, "utf8"))]));
  const generated = generateV2Data(options, onProgress, exclusions);
  for (const [path, hash] of Object.entries(sourceHashes)) if (contentHash(readFileSync(path, "utf8")) !== hash) throw new Error(`Source changed while generating: ${path}`);
  mkdirSync(output, { recursive: true });
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const write = (name: string, data: unknown[]) => {
    const text = data.map(row => JSON.stringify(row)).join("\n") + "\n";
    writeFileSync(join(output, name), text, { flag: "wx" }); files[name] = { sha256: contentHash(text), bytes: Buffer.byteLength(text) };
  };
  for (const split of ["train", "validation"] as const) write(`${split}.jsonl`, generated.rows.filter(row => row.split === split).map(row => ({ messages: [...optimizerMessages(row.task, row.before, row.feedback.before, row.previousAttempts), { role: "assistant", content: JSON.stringify(row.action) }] })));
  write("raw-transitions.jsonl", generated.rows); write("test-factories.jsonl", generated.cases); write("geometric-certificates.jsonl", generated.certificates);
  const stats = Object.fromEntries((["train", "validation"] as const).map(split => {
    const rows = generated.rows.filter(row => row.split === split), moves = rows.filter(row => row.action.op === "move");
    return [split, { examples: rows.length, buildings: options.buildings[split], moves: moves.length, stop: rows.length - moves.length, targetFullGoalBoth: rows.filter(row => row.feedback.after.goalMet && row.gate.after.goalMet).length, sorterMoves: moves.filter(row => { const action = row.action; return action.op === "move" && row.before.stations.find(station => station.id === action.stationId)?.kind === "sorter"; }).length, historyStatuses: Object.fromEntries(["invalid", "rejected", "accepted"].map(status => [status, rows.filter(row => row.previousAttempts.some(attempt => attempt.status === status)).length])), emptyHistory: rows.filter(row => !row.previousAttempts.length).length, trajectoryLengths: Object.fromEntries([0, 1, 6].map(length => [length, rows.filter(row => row.trajectoryLength === length).length])) }];
  }));
  const manifest = {
    schemaVersion: 1, taskProfile: "optimizer", promptProfile: OPTIMIZER_PROMPT_PROFILE, task: "constructive-full-goal-optimizer-curriculum-v2", simVersion: SIM_VERSION, graderHash: generated.graderHash,
    options, files, sourceHashes, stats: { ...stats, test: { examples: generated.cases.length, buildings: options.buildings.test, scored: false }, rejectedTrainingGeometries: generated.rejectedTrainingGeometries, rejectedTrainingDemandDraws: generated.rejectedTrainingDemandDraws, retriedTrajectories: generated.retriedTrajectories, elapsedMs: generated.elapsedMs },
    splitBuildingHashes: generated.splitBuildingHashes, splitDemandSeeds: generated.splitDemandSeeds, excludedBuildingHashes: [...generated.exclusions.buildings], excludedDemandSeeds: [...generated.exclusions.demands ?? []], consumedBuildingHashes: generated.consumedBuildingHashes, exclusionSources: generated.exclusions.sources,
    labelSource: "Geometrically certified safe endpoints plus reverse perturbations, each reverse move verified as a legal monotonic improvement on four feedback and four gate days. Training geometries and demand draws are curated for full-goal endpoints, with every rejected geometry/demand seed retained in provenance. Both day sets participate in training-data selection; gate days are verification data, not an unbiased holdout. Full-goal stops certify completion, not objective optimality.",
    historySource: "Every negative history action is actually applied or attempted; rejected actions have real feedback simulator results. They are input context only; target actions are verified corrective moves.",
    splitPolicy: "All v1 critic, optimizer train/validation/test, twenty exploratory geometries, and recorded v2 development/fixture/benchmark geometries and demands excluded. New train/validation/test buildings disjoint under rotation/reflection. Test starts use unfiltered random legal perturbations and are never scored during generation.",
    limitations: "Constructive curriculum states are curated around known full-goal endpoints, not a representative sample of deployment starts. Teacher endpoint feasibility is not proof of a monotonic path. Direct teacher planner searches one minimum-change endpoint and can return unresolved without proving impossibility. No model or held-out final inference performed during data preparation.",
  };
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}
