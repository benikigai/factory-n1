import { exportOptimizerReplays } from "../src/training/optimizer-replay.ts";

const args = process.argv.slice(2);
const supported = new Set(["--evaluation", "--data", "--out"]);
if (args.includes("--help")) {
  console.log("Usage: npx tsx scripts/build-optimizer-replay.ts [--evaluation runs/optimizer-eval/test-v1] [--data runs/optimizer-data/v1] [--out runs/optimizer-viewer/data]\nOffline only. Re-simulates saved results, rejects mismatches, and exports all 20 factories and 80 traces separately from the frozen demo.");
} else {
  if (args.length % 2 || args.some((value, i) => i % 2 === 0 && !supported.has(value))) throw new Error("Unknown or incomplete argument; use --help");
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (values.has(args[i])) throw new Error(`Repeated argument ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  console.log(JSON.stringify(exportOptimizerReplays({ evaluationDirectory: values.get("--evaluation"), dataDirectory: values.get("--data"), outputDirectory: values.get("--out") }), null, 2));
}
