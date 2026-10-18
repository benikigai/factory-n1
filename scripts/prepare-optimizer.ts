import { DEFAULT_OPTIMIZER_DATA_OPTIONS, exportOptimizerData } from "../src/training/optimizer-data.ts";

const args = process.argv.slice(2);
const supported = new Set(["--out", "--seed", "--train-buildings", "--validation-buildings", "--test-buildings", "--examples-per-building", "--candidates"]);
if (args.includes("--help")) {
  console.log("Usage: npx tsx scripts/prepare-optimizer.ts [--out runs/optimizer-data/v1] [--seed 2026101702] [--train-buildings 60] [--validation-buildings 10] [--test-buildings 20] [--examples-per-building 20] [--candidates 48]\nOffline simulator only. Train/validation include verified before-action-after moves. Test factories remain unscored.");
} else {
  if (args.length % 2 || args.some((value, i) => i % 2 === 0 && !supported.has(value))) throw new Error("Unknown or incomplete argument; use --help");
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (values.has(args[i])) throw new Error(`Repeated argument ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  const number = (key: string, fallback: number) => values.has(key) ? Number(values.get(key)) : fallback;
  const options = {
    seed: number("--seed", DEFAULT_OPTIMIZER_DATA_OPTIONS.seed),
    examplesPerBuilding: number("--examples-per-building", DEFAULT_OPTIMIZER_DATA_OPTIONS.examplesPerBuilding),
    candidates: number("--candidates", DEFAULT_OPTIMIZER_DATA_OPTIONS.candidates),
    buildings: {
      train: number("--train-buildings", DEFAULT_OPTIMIZER_DATA_OPTIONS.buildings.train),
      validation: number("--validation-buildings", DEFAULT_OPTIMIZER_DATA_OPTIONS.buildings.validation),
      test: number("--test-buildings", DEFAULT_OPTIMIZER_DATA_OPTIONS.buildings.test),
    },
  };
  const output = values.get("--out") ?? "runs/optimizer-data/v1";
  const manifest = exportOptimizerData(output, options, info => console.error(JSON.stringify(info)));
  console.log(JSON.stringify({ output, graderHash: manifest.graderHash, files: manifest.files, stats: manifest.stats }, null, 2));
}
