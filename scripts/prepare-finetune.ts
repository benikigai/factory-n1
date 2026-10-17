import { DEFAULT_DATASET_OPTIONS, exportDataset } from "../src/training/dataset.ts";

const args = process.argv.slice(2);
const supported = new Set(["--out", "--seed", "--train-buildings", "--validation-buildings", "--test-buildings", "--examples-per-building"]);
if (args.includes("--help")) {
  console.log("Usage: npx tsx scripts/prepare-finetune.ts [--out runs/finetune-data/NAME] [--seed 20261017] [--train-buildings 30] [--validation-buildings 5] [--test-buildings 5] [--examples-per-building 20]\nOffline only. Creates train/validation/test JSONL, raw labels, and a manifest. Never uploads or trains.");
} else {
  if (args.length % 2 || args.some((value, i) => i % 2 === 0 && !supported.has(value))) throw new Error("Unknown or incomplete argument; use --help");
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (values.has(args[i])) throw new Error(`Repeated argument ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  const number = (key: string, fallback: number) => values.has(key) ? Number(values.get(key)) : fallback;
  const options = {
    seed: number("--seed", DEFAULT_DATASET_OPTIONS.seed),
    examplesPerBuilding: number("--examples-per-building", DEFAULT_DATASET_OPTIONS.examplesPerBuilding),
    buildings: {
      train: number("--train-buildings", DEFAULT_DATASET_OPTIONS.buildings.train),
      validation: number("--validation-buildings", DEFAULT_DATASET_OPTIONS.buildings.validation),
      test: number("--test-buildings", DEFAULT_DATASET_OPTIONS.buildings.test),
    },
  };
  const output = values.get("--out") ?? "runs/finetune-data/critic-v1";
  const manifest = exportDataset(output, options);
  console.log(JSON.stringify({ output, graderHash: manifest.graderHash, stats: manifest.stats }, null, 2));
}
