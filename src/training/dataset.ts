import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import { criticInput, criticMessages, labelLayout, type CriticOutput, type DemandDay } from "./critic.ts";
import { buildingHash, contentHash, generateBuilding, generateCandidate, layoutHash, type CandidateFamily } from "./generate.ts";

export const DATA_SPLITS = ["train", "validation", "test"] as const;
export type DataSplit = typeof DATA_SPLITS[number];
export interface DatasetOptions {
  seed: number;
  buildings: Record<DataSplit, number>;
  examplesPerBuilding: number;
}
export const DEFAULT_DATASET_OPTIONS: DatasetOptions = { seed: 20261017, buildings: { train: 30, validation: 5, test: 5 }, examplesPerBuilding: 20 };
export interface TrainingRow {
  id: string;
  split: DataSplit;
  buildingId: string;
  buildingHash: string;
  layoutHash: string;
  geometrySeed: number;
  proposalSeed: number;
  family: CandidateFamily;
  input: ReturnType<typeof criticInput>;
  output: CriticOutput;
  days: ReturnType<typeof labelLayout>["days"];
}

export function generateDataset(options: DatasetOptions = DEFAULT_DATASET_OPTIONS): TrainingRow[] {
  if (!Number.isSafeInteger(options.seed) || options.seed < 1 || !Number.isSafeInteger(options.examplesPerBuilding) || options.examplesPerBuilding < 1 || options.examplesPerBuilding > 1000 || DATA_SPLITS.some(split => !Number.isSafeInteger(options.buildings[split]) || options.buildings[split] < 1 || options.buildings[split] > 100)) {
    throw new Error("Invalid dataset sizes or seed");
  }
  const frozenGrader = graderHash();
  const seenBuildings = new Set<string>(), seenLayouts = new Set<string>();
  const rows: TrainingRow[] = [];
  for (const [splitIndex, split] of DATA_SPLITS.entries()) {
    for (let i = 0; i < options.buildings[split]; i++) {
      const buildingId = `${split}-building-${i + 1}`;
      let geometrySeed = options.seed + splitIndex * 1_000_000 + i * 1009;
      let task = generateBuilding(geometrySeed, buildingId, i % 5 === 4);
      for (let attempt = 0; seenBuildings.has(buildingHash(task)); attempt++) {
        if (attempt > 1000) throw new Error("Could not generate a disjoint building");
        task = generateBuilding(++geometrySeed, buildingId, i % 5 === 4);
      }
      const geometryHash = buildingHash(task);
      seenBuildings.add(geometryHash);
      // Distinct demands per building also prevent seed memorization across evaluation splits.
      const demand: DemandDay[] = (["normal", "peak", "fragile", "skewed"] as const).map((profile, j) => ({ seed: 4_000_000 + splitIndex * 100_000 + i * 100 + j, profile, count: 100 }));
      let accepted = 0;
      for (let attempt = 0; accepted < options.examplesPerBuilding; attempt++) {
        if (attempt > options.examplesPerBuilding * 100) throw new Error("Could not generate enough distinct proposals");
        const proposalSeed = geometrySeed + 10_000 + attempt * 101;
        const { layout, family } = generateCandidate(task, proposalSeed, attempt);
        const candidateHash = layoutHash(layout);
        if (seenLayouts.has(candidateHash)) continue;
        seenLayouts.add(candidateHash);
        const { output, days } = labelLayout(task, layout, demand);
        rows.push({ id: `${buildingId}-example-${++accepted}`, split, buildingId, buildingHash: geometryHash, layoutHash: candidateHash, geometrySeed, proposalSeed, family, input: criticInput(task, layout, demand), output, days });
      }
    }
  }
  if (graderHash() !== frozenGrader) throw new Error("Grader changed during data generation");
  return rows;
}

export function chatExample(row: TrainingRow) {
  return { messages: [...criticMessages(row.input), { role: "assistant" as const, content: JSON.stringify(row.output) }] };
}

function splitStats(rows: TrainingRow[]) {
  const values = rows.filter(row => row.output.valid).map(row => row.output.metrics!.objective);
  return {
    examples: rows.length, buildings: new Set(rows.map(row => row.buildingHash)).size,
    uniqueLayouts: new Set(rows.map(row => row.layoutHash)).size,
    valid: rows.filter(row => row.output.valid).length, invalid: rows.filter(row => !row.output.valid).length,
    zeroDamage: rows.filter(row => row.output.zeroDamage).length,
    allShipped: rows.filter(row => row.output.allShipped).length,
    goalMet: rows.filter(row => row.output.goalMet).length,
    objectiveRange: values.length ? [Math.min(...values), Math.max(...values)] : null,
    families: Object.fromEntries([...new Set(rows.map(row => row.family))].map(family => [family, rows.filter(row => row.family === family).length])),
  };
}

/** Only creates a new directory below the ignored runs/finetune-data tree. */
export function exportDataset(outputDirectory: string, options: DatasetOptions = DEFAULT_DATASET_OPTIONS) {
  const output = resolve(outputDirectory), allowed = resolve("runs/finetune-data");
  if (!output.startsWith(`${allowed}/`) || existsSync(output)) throw new Error("Output must be a new directory inside runs/finetune-data/");
  const before = graderHash();
  const rows = generateDataset(options);
  const files: Record<string, { sha256: string; bytes: number }> = {};
  mkdirSync(output, { recursive: true });
  const write = (name: string, contents: string) => {
    writeFileSync(join(output, name), contents, { flag: "wx" });
    files[name] = { sha256: contentHash(contents), bytes: Buffer.byteLength(contents) };
  };
  for (const split of DATA_SPLITS) write(`${split}.jsonl`, rows.filter(row => row.split === split).map(row => JSON.stringify(chatExample(row))).join("\n") + "\n");
  write("raw-labels.jsonl", rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const sourcePaths = ["scripts/prepare-finetune.ts", "src/training/critic.ts", "src/training/generate.ts", "src/training/dataset.ts"];
  const manifest = {
    schemaVersion: 1, task: "single-turn-factory-layout-critic", labelSource: "unchanged deterministic simulator, no teacher model", simVersion: SIM_VERSION,
    graderHash: before, options, files,
    sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, contentHash(readFileSync(path, "utf8"))])),
    splitPolicy: "Entire newly generated buildings, grouped across rotations/reflections, are disjoint. Demand seeds and layout hashes are also disjoint. No historical runs, F/G layouts, reserved train/select/test/final seeds, or locked final evaluations were used.",
    evaluationPolicy: "Upload only train.jsonl and validation.jsonl. Keep test.jsonl and raw-labels.jsonl local until model selection is frozen. Test contains new synthetic buildings, not the existing locked final split.",
    intendedBaseModel: "nvidia/nemotron-3.5-lightning-30b-a3b",
    format: "JSONL messages: system, user, assistant; final JSON only, no reasoning/tool transcripts",
    providerDocs: ["https://docs.cloud.crusoe.ai/serverless-fine-tuning/fine-tune-a-model/index.html", "https://docs.cloud.crusoe.ai/serverless-fine-tuning/available-models/index.html"],
    limitations: "Labels are exact for four seeded 100-package demand days per building; the student predicts these metrics and may be approximate. Synthetic rectangular buildings do not establish real-factory generalization or a state-transition world model.",
    stats: Object.fromEntries(DATA_SPLITS.map(split => [split, splitStats(rows.filter(row => row.split === split))])),
  };
  if (graderHash() !== before) throw new Error("Grader changed during export");
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}
