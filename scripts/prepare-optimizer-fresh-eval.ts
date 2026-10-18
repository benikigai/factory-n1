import { exportFreshEvaluation, preflightFreshEvaluation } from "../src/training/optimizer-fresh-eval-data.ts";

const mode = process.argv[2];
if (!["generate", "check"].includes(mode) || process.argv.length > 4) throw new Error("Usage: npx tsx scripts/prepare-optimizer-fresh-eval.ts generate|check [runs/optimizer-data/v3-eval]");
const directory = process.argv[3] ?? "runs/optimizer-data/v3-eval";
console.log(JSON.stringify(mode === "generate" ? exportFreshEvaluation(process.cwd(), directory) : preflightFreshEvaluation(process.cwd(), directory), null, 2));
