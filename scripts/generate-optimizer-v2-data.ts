import { DEFAULT_V2_OPTIONS, exportV2Data } from "../src/training/optimizer-v2-data.ts";

const args = process.argv.slice(2), supported = new Set(["--out", "--seed", "--train-buildings", "--validation-buildings", "--test-buildings"]);
if (args.includes("--help")) console.log("Usage: npx tsx scripts/generate-optimizer-v2-data.ts [--out runs/optimizer-data/v2] [--seed 1370100001] [--train-buildings 60] [--validation-buildings 10] [--test-buildings 20]\nOffline only. Full-goal geometric curriculum with real negative histories; twenty examples per building and unscored test starts.");
else {
  if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !supported.has(arg))) throw new Error("Unknown/incomplete option");
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { if (values.has(args[i])) throw new Error("Repeated option"); values.set(args[i], args[i + 1]); }
  const number = (name: string, fallback: number) => values.has(name) ? Number(values.get(name)) : fallback;
  const options = { seed: number("--seed", DEFAULT_V2_OPTIONS.seed), buildings: { train: number("--train-buildings", DEFAULT_V2_OPTIONS.buildings.train), validation: number("--validation-buildings", DEFAULT_V2_OPTIONS.buildings.validation), test: number("--test-buildings", DEFAULT_V2_OPTIONS.buildings.test) } };
  const manifest = exportV2Data(values.get("--out") ?? "runs/optimizer-data/v2", options, progress => console.error(JSON.stringify(progress)));
  console.log(JSON.stringify({ files: manifest.files, stats: manifest.stats, graderHash: manifest.graderHash }, null, 2));
}
