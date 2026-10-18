import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SPLITS } from "../sim/scenarios.ts";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import { FACTORIES, loadTask, validateForTask, type FactoryId, type Task } from "../tasks/task.ts";
import type { DemandDay } from "./critic.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "./generate.ts";
import { legalMoveActions, type OptimizerCase } from "./optimizer-data.ts";
import { applyAction, OPTIMIZER_PROMPT_PROFILE } from "./optimizer.ts";

export const FRESH_EVAL_OPTIONS = { geometrySeed: 2_270_100_001, demandSeed: 2_370_100_001, factories: 20 } as const;
const profiles = ["normal", "peak", "fragile", "skewed"] as const;
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generationSources = ["src/training/optimizer-fresh-eval-data.ts", "scripts/prepare-optimizer-fresh-eval.ts", "src/training/generate.ts", "src/training/optimizer-data.ts", "src/training/optimizer.ts", "src/tasks/task.ts"];
export interface FileReceipt { path: string; sha256: string; bytes: number }
export interface FreshExclusions {
  buildings: Set<string>;
  layouts: Set<string>;
  demands: Set<number>;
  demandRanges: { first: number; last: number; reason: string }[];
  sources: FileReceipt[];
}
export interface FreshOptions { geometrySeed: number; demandSeed: number; factories: number }
const uint32 = (seed: number) => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
const readText = (path: string) => readFileSync(path, "utf8");
const digest = (text: string) => ({ sha256: contentHash(text), bytes: Buffer.byteLength(text) });
const demandBlocked = (seed: number, exclusions: FreshExclusions) => exclusions.demands.has(seed) || exclusions.demandRanges.some(range => seed >= range.first && seed <= range.last);
const days = (seed: number): DemandDay[] => profiles.map((profile, index) => ({ seed: seed + index, profile, count: 100 }));

/** Reads prior inputs and identities only. No outcome is used to select the new cohort. */
export function collectFreshExclusions(root = process.cwd()): FreshExclusions {
  const result: FreshExclusions = {
    buildings: new Set(), layouts: new Set(), demands: new Set(Object.values(SPLITS).flat().map(day => day.seed)), sources: [],
    // Earlier v1 searches did not retain every rejected demand. Reserve their entire namespace,
    // plus all documented fixture/development seeds, instead of claiming the saved seeds are exhaustive.
    demandRanges: [{ first: 0, last: 2_200_000_000, reason: "Conservative reservation of all prior critic, v1, v2, development, exploration and fixture demand namespaces, including unrecorded rejected v1 searches" }],
  };
  const recorded = new Set<string>();
  const read = (path: string) => {
    const text = readText(resolve(root, path));
    if (!recorded.has(path)) { result.sources.push({ path, ...digest(text) }); recorded.add(path); }
    return text;
  };
  const addTask = (task: Task) => { result.buildings.add(buildingHash(task)); result.layouts.add(layoutHash(task.initial)); };
  const addDays = (values: DemandDay[] = []) => { for (const day of values) { if (!uint32(day.seed)) throw new Error("Previous demand seed has ambiguous uint32 identity"); result.demands.add(day.seed); } };
  const addCase = (row: OptimizerCase) => {
    addTask(row.task);
    if (row.buildingHash !== buildingHash(row.task) || row.initialLayoutHash !== layoutHash(row.initial)) throw new Error(`Prior case identity mismatch: ${row.id}`);
    result.layouts.add(row.initialLayoutHash); addDays(row.feedbackDays); addDays(row.finalDays);
  };
  for (const id of Object.keys(FACTORIES) as FactoryId[]) { read(`layouts/${FACTORIES[id]}`); addTask(loadTask(id)); }
  const critic = "runs/finetune-data/critic-v1/raw-labels.jsonl";
  for (const line of read(critic).trim().split("\n")) {
    const row = JSON.parse(line), input = row.input;
    addTask({ id: "previous-critic", initial: input.layout, goal: input.goal, fixed: input.constraints.fixedStations.map((station: { id: string }) => station.id), editable: { sorter: input.constraints.sorter, pack: input.constraints.pack }, capexCap: input.constraints.capexCap });
    addDays(input.demand);
  }
  const dataRoot = resolve(root, "runs/optimizer-data");
  for (const entry of readdirSync(dataRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const path = `runs/optimizer-data/${entry.name}/manifest.json`;
    if (!existsSync(resolve(root, path))) continue;
    const manifest = JSON.parse(read(path));
    for (const hash of [...manifest.excludedBuildingHashes ?? [], ...manifest.consumedBuildingHashes ?? [], ...Object.values(manifest.splitBuildingHashes ?? {}).flat()]) result.buildings.add(hash as string);
    for (const seed of [...manifest.excludedDemandSeeds ?? [], ...Object.values(manifest.splitDemandSeeds ?? {}).flat()]) { if (!uint32(seed as number)) throw new Error("Previous manifest seed is invalid"); result.demands.add(seed as number); }
    for (const range of manifest.excludedDemandSeedRanges ?? []) result.demandRanges.push(range);
    for (const name of ["raw-transitions.jsonl", "test-factories.jsonl"]) {
      const rowPath = `runs/optimizer-data/${entry.name}/${name}`;
      if (!existsSync(resolve(root, rowPath))) continue;
      const text = read(rowPath), receipt = manifest.files?.[name];
      if (!receipt || receipt.sha256 !== contentHash(text) || receipt.bytes !== Buffer.byteLength(text)) throw new Error(`Prior data hash mismatch: ${rowPath}`);
      for (const line of text.trim().split("\n")) {
        const row = JSON.parse(line);
        if (name === "test-factories.jsonl") addCase(row);
        else { addTask(row.task); result.layouts.add(layoutHash(row.before)); result.layouts.add(layoutHash(row.after)); addDays(row.feedbackDays); addDays(row.gateDays); }
      }
    }
  }
  for (const name of ["v2-consumed-development.json", "v2-fixture-exclusions.json"]) {
    const data = JSON.parse(read(`runs/optimizer-data/${name}`));
    for (const hash of data.buildingHashes) result.buildings.add(hash);
    for (const seed of data.demandSeeds) { if (!uint32(seed)) throw new Error("Invalid development demand seed"); result.demands.add(seed); }
  }
  for (const line of read("runs/optimizer-v2-assessment/exploratory-probes.jsonl").trim().split("\n")) addCase(JSON.parse(line));
  // Offline tests also count as exposed geometries. These are the documented fixture seeds;
  // source receipts make the list auditable. All their demands are inside the reserved range.
  for (const path of ["test/training-data.test.ts", "test/optimizer-data.test.ts", "test/optimizer-evaluation.test.ts", "test/optimizer-v2-data.test.ts", "test/optimizer-v2-evaluate.test.ts", "test/optimizer-v2-continuation.test.ts", "test/optimizer-replay.test.ts", "optimizer-v2-viewer/replay.test.ts"]) read(path);
  const fixtureSeeds = [20261017, 20261018, 2026101702, 2026101704, 78167222, ...Array.from({ length: 3 }, (_, i) => 89167111 + i * 231), ...Array.from({ length: 3 }, (_, i) => 20271000 + i), 845139, 846148];
  for (const seed of fixtureSeeds) { addTask(generateBuilding(seed, "previous-fixture")); addTask(generateBuilding(seed, "previous-fixture", true)); }
  // v1 test generation can skip an explicitly excluded first geometry. Cover nearby retry seeds.
  for (const base of [20261017, 2026101702]) for (let split = 0; split < 3; split++) for (let i = 0; i < 2; i++) for (let retry = 0; retry < 12; retry++) addTask(generateBuilding(base + split * 1_000_000 + i * 1009 + retry, "previous-fixture-candidate"));
  result.sources.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}

/** Pure unscored generation; injected geometry is for isolated fixtures only. */
export function generateFreshCases(exclusions: FreshExclusions, options: FreshOptions = FRESH_EVAL_OPTIONS, makeBuilding: typeof generateBuilding = generateBuilding) {
  if (options.factories !== 20 || !uint32(options.geometrySeed) || !uint32(options.demandSeed) || !uint32(options.geometrySeed + 1_000_000) || !uint32(options.demandSeed + 19 * 1000 + 7)) throw new Error("Fresh evaluation needs exactly 20 factories and non-wrapping uint32 seeds");
  const buildings = new Set(exclusions.buildings), layouts = new Set(exclusions.layouts), cases: OptimizerCase[] = [];
  let identityRetries = 0;
  for (let i = 0; i < options.factories; i++) {
    const id = `optimizer-v3-test-building-${i + 1}`;
    let geometrySeed = options.geometrySeed + i * 1009, task = makeBuilding(geometrySeed, id);
    while (buildings.has(buildingHash(task))) {
      if (++identityRetries > 10000) throw new Error("Could not find fresh geometry within bounded identity-only retries");
      task = makeBuilding(++geometrySeed, id);
    }
    let initial = structuredClone(task.initial);
    for (let move = 0; move < 3 + geometrySeed % 8; move++) {
      const action = legalMoveActions(task, initial, geometrySeed + move * 104729, 1)[0];
      if (action) initial = applyAction(task, initial, action);
    }
    const errors = validateForTask(initial, task), hash = buildingHash(task), initialHash = layoutHash(initial);
    if (errors.length || layouts.has(initialHash)) throw new Error("Fresh initial layout invalid or previously exposed");
    const first = options.demandSeed + i * 1000;
    const feedbackDays = days(first), finalDays = days(first + 4);
    if ([...feedbackDays, ...finalDays].some(day => demandBlocked(day.seed, exclusions))) throw new Error("Fresh demand overlaps a previous demand or reserved namespace");
    buildings.add(hash); layouts.add(initialHash);
    cases.push({ id, split: "test", buildingId: id, buildingHash: hash, geometrySeed, initialLayoutHash: initialHash, task, initial, feedbackDays, finalDays });
  }
  validateFreshCases(cases, exclusions);
  return { cases, identityRetries, simulatorCalls: 0 as const };
}

export function validateFreshCases(cases: OptimizerCase[], exclusions: FreshExclusions) {
  if (cases.length !== 20) throw new Error("Expected exactly 20 fresh factories");
  const buildingIds = new Set<string>(), layoutIds = new Set<string>(), ids = new Set<string>(), seeds = new Set<number>();
  const caseKeys = ["id", "split", "buildingId", "buildingHash", "geometrySeed", "initialLayoutHash", "task", "initial", "feedbackDays", "finalDays"].sort().join(",");
  for (const row of cases) {
    if (Object.keys(row).sort().join(",") !== caseKeys || row.split !== "test" || row.id !== row.buildingId || !uint32(row.geometrySeed)) throw new Error("Malformed fresh case or outcome fields present");
    if (ids.has(row.id) || buildingIds.has(row.buildingHash) || exclusions.buildings.has(row.buildingHash) || buildingHash(row.task) !== row.buildingHash || layoutIds.has(row.initialLayoutHash) || exclusions.layouts.has(row.initialLayoutHash) || layoutHash(row.initial) !== row.initialLayoutHash) throw new Error("Factory identity overlaps or hash mismatches");
    if (validateForTask(row.task.initial, row.task).length || validateForTask(row.initial, row.task).length) throw new Error("Invalid fresh layout");
    ids.add(row.id); buildingIds.add(row.buildingHash); layoutIds.add(row.initialLayoutHash);
    for (const group of [row.feedbackDays, row.finalDays]) {
      if (group.length !== 4 || group.map(day => day.profile).join(",") !== profiles.join(",")) throw new Error("Each day set needs the four fixed profiles");
      for (const day of group) {
        if (day.count !== 100 || !uint32(day.seed) || seeds.has(day.seed) || demandBlocked(day.seed, exclusions)) throw new Error("Demand collision, reserved seed, or invalid count");
        seeds.add(day.seed);
      }
    }
  }
  return { factories: cases.length, uniqueBuildings: buildingIds.size, uniqueDemandSeeds: seeds.size, scored: false as const, simulatorCalls: 0 };
}

const snapshots = (paths: string[], root: string) => Object.fromEntries(paths.map(path => [path, contentHash(readText(resolve(root, path)))]));
function unchanged(hashes: Record<string, string>, root: string) {
  for (const [path, hash] of Object.entries(hashes)) if (contentHash(readText(resolve(root, path))) !== hash) throw new Error(`Source changed: ${path}`);
}
function trainingFiles(root: string) {
  const path = "runs/optimizer-data/v2/manifest.json", text = readText(resolve(root, path)), manifest = JSON.parse(text);
  if (manifest.taskProfile !== "optimizer" || manifest.promptProfile !== OPTIMIZER_PROMPT_PROFILE || manifest.graderHash !== graderHash() || manifest.sourceHashes["src/training/optimizer.ts"] !== contentHash(readText(resolve(SOURCE_ROOT, "src/training/optimizer.ts")))) throw new Error("Original v2 training manifest no longer matches the frozen prompt and grader");
  const files = Object.fromEntries(["train.jsonl", "validation.jsonl"].map(name => {
    const bytes = readText(resolve(root, "runs/optimizer-data/v2", name));
    if (manifest.files[name].sha256 !== contentHash(bytes) || manifest.files[name].bytes !== Buffer.byteLength(bytes)) throw new Error(`Original v2 ${name} changed`);
    return [name, bytes];
  }));
  return { path, sha256: contentHash(text), manifest, files };
}

export function exportFreshEvaluation(root = process.cwd(), outputDirectory = "runs/optimizer-data/v3-eval") {
  root = resolve(root);
  const output = resolve(root, outputDirectory), parent = resolve(root, "runs/optimizer-data");
  if (!output.startsWith(parent + "/") || dirname(output) !== parent || existsSync(output)) throw new Error("Output must be a new direct child of runs/optimizer-data");
  const sourceHashes = snapshots(generationSources, SOURCE_ROOT), frozenGrader = graderHash(), training = trainingFiles(root), exclusions = collectFreshExclusions(root);
  const generated = generateFreshCases(exclusions);
  const testText = generated.cases.map(row => JSON.stringify(row)).join("\n") + "\n";
  const manifest = {
    schemaVersion: 1, taskProfile: "optimizer", promptProfile: OPTIMIZER_PROMPT_PROFILE, task: "fresh-evaluation-only-v3", simVersion: SIM_VERSION, graderHash: frozenGrader,
    options: FRESH_EVAL_OPTIONS, sourceHashes, trainingFilesBundled: true, trainingSource: { path: training.path, sha256: training.sha256, unchanged: true },
    files: { "train.jsonl": training.manifest.files["train.jsonl"], "validation.jsonl": training.manifest.files["validation.jsonl"], "test-factories.jsonl": digest(testText) },
    splitBuildingHashes: { train: [], validation: [], test: generated.cases.map(row => row.buildingHash) }, splitDemandSeeds: { train: [], validation: [], test: generated.cases.flatMap(row => [...row.feedbackDays, ...row.finalDays].map(day => day.seed)) },
    excludedBuildingHashes: [...exclusions.buildings].sort(), excludedLayoutHashes: [...exclusions.layouts].sort(), excludedDemandSeeds: [...exclusions.demands].sort((a, b) => a - b), excludedDemandSeedRanges: exclusions.demandRanges,
    exclusionSources: exclusions.sources, stats: { test: { examples: 20, buildings: 20, scored: false }, simulatorCalls: 0, identityRetries: generated.identityRetries },
    selectionPolicy: "Exactly twenty first unseen geometries after identity-only rejection. Same unfiltered 3-10 legal perturbation policy as v2 test. No teacher, objective, damage, goal, or feasibility search is called. Four feedback and four final 100-package days per factory. All twenty earlier v2 test factories excluded regardless of completion status.",
    trainingPolicy: "No retraining. Bundled train and validation files are byte-identical copies of the original v2 adapter data, retained for the existing independent audit. Empty train/validation split identity lists describe this evaluation-only sampling operation; all previous identities remain excluded.",
    evaluationPolicy: "Keep original four model artifacts, prompt, grader, 12 proposal opportunities, case/round rotation, greedy temperature-zero decoding, 128 output-token ceiling and no automatic retries. Score final demand only after all arms finish search. No final outcomes generated by this preparation step.",
  };
  unchanged(sourceHashes, SOURCE_ROOT); unchanged(Object.fromEntries(exclusions.sources.map(source => [source.path, source.sha256])), root);
  if (graderHash() !== frozenGrader || trainingFiles(root).sha256 !== training.sha256) throw new Error("Frozen training/grader changed while preparing");
  const staging = `${output}.preparing-${process.pid}`;
  if (existsSync(staging)) throw new Error("Staging directory already exists");
  mkdirSync(staging);
  try {
    for (const [name, bytes] of Object.entries(training.files)) writeFileSync(join(staging, name), bytes, { flag: "wx" });
    writeFileSync(join(staging, "test-factories.jsonl"), testText, { flag: "wx" });
    writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    if (existsSync(output)) throw new Error("Output appeared during preparation");
    renameSync(staging, output);
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
  return { outputDirectory: relative(root, output), manifestHash: contentHash(readText(join(output, "manifest.json"))), factories: 20, testData: manifest.files["test-factories.jsonl"], simulatorCalls: 0, trainingUnchanged: true };
}

export function preflightFreshEvaluation(root = process.cwd(), directory = "runs/optimizer-data/v3-eval") {
  const folder = resolve(root, directory), text = readText(join(folder, "manifest.json")), manifest = JSON.parse(text), training = trainingFiles(root);
  if (manifest.task !== "fresh-evaluation-only-v3" || manifest.taskProfile !== "optimizer" || manifest.promptProfile !== OPTIMIZER_PROMPT_PROFILE || manifest.graderHash !== graderHash() || manifest.trainingSource?.sha256 !== training.sha256 || manifest.stats?.simulatorCalls !== 0) throw new Error("Fresh manifest policy/provenance mismatch");
  unchanged(manifest.sourceHashes, SOURCE_ROOT); unchanged(Object.fromEntries(manifest.exclusionSources.map((source: FileReceipt) => [source.path, source.sha256])), root);
  for (const name of ["train.jsonl", "validation.jsonl", "test-factories.jsonl"]) {
    const bytes = readText(join(folder, name)), expected = manifest.files[name];
    if (contentHash(bytes) !== expected.sha256 || Buffer.byteLength(bytes) !== expected.bytes) throw new Error(`Fresh file hash mismatch: ${name}`);
    if (name !== "test-factories.jsonl" && expected.sha256 !== training.manifest.files[name].sha256) throw new Error("Training data was changed");
  }
  const exclusions: FreshExclusions = { buildings: new Set(manifest.excludedBuildingHashes), layouts: new Set(manifest.excludedLayoutHashes), demands: new Set(manifest.excludedDemandSeeds), demandRanges: manifest.excludedDemandSeedRanges, sources: manifest.exclusionSources };
  const cases = readText(join(folder, "test-factories.jsonl")).trim().split("\n").map(line => JSON.parse(line) as OptimizerCase);
  const result = validateFreshCases(cases, exclusions);
  if (contentHash(manifest.splitBuildingHashes.test) !== contentHash(cases.map(row => row.buildingHash)) || contentHash(manifest.splitDemandSeeds.test) !== contentHash(cases.flatMap(row => [...row.feedbackDays, ...row.finalDays].map(day => day.seed)))) throw new Error("Fresh split inventory mismatch");
  return { ...result, manifestHash: contentHash(text), trainingUnchanged: true };
}
