import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { contentHash } from "../src/training/generate.ts";
import { freezeOptimizerEvaluation, readOptimizerCases, runOptimizerEvaluation, validateOptimizerHealth, type OptimizerProvenance, type OptimizerCall } from "../src/training/optimizer-evaluate.ts";

const HELP = `Usage: npx tsx scripts/evaluate-optimizer.ts --final-eval [options]
Default is an offline preflight. No model calls without --live.
  --data runs/optimizer-data/NAME
  --out runs/optimizer-eval/NAME       Must be a new directory
  --base-model factory-optimizer-base --tuned-model factory-optimizer-lora
  --base-url http://127.0.0.1:8000/v1  SSH tunnel to private VM server
  --provenance FILE                   Completed optimizer training provenance
  --factories 20 --max-calls 120 --max-tokens-per-arm 1000000
  --max-simulations-per-arm 480 --random-seed 202610173
  --final-eval                        Explicitly open the fresh test factories
  --live                              Permit inference requests after health validation
Three proposals per arm/factory, 128 output tokens, temperature 0, no retries.
Stop/invalid actions consume their opportunity. Failed calls preserve token reservations.
The random legal-move baseline uses the same three simulator opportunities.
Final demand scores are collected only after all search arms have finished.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log(HELP); return; }
  const values = new Map<string, string>(), flags = new Set<string>();
  const allowed = new Set(["--data", "--out", "--base-model", "--tuned-model", "--base-url", "--provenance", "--factories", "--max-calls", "--max-tokens-per-arm", "--max-simulations-per-arm", "--random-seed"]);
  for (let i = 0; i < args.length; i++) {
    if (["--live", "--final-eval"].includes(args[i])) { if (flags.has(args[i])) throw new Error("Repeated flag"); flags.add(args[i]); continue; }
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) throw new Error("Unknown, repeated or incomplete option; use --help");
    values.set(args[i], args[++i]);
  }
  const numeric = (key: string, fallback: number) => values.has(key) ? Number(values.get(key)) : fallback;
  const provenance = values.has("--provenance") ? JSON.parse(readFileSync(values.get("--provenance")!, "utf8")) as OptimizerProvenance : undefined;
  const plan = freezeOptimizerEvaluation({
    dataDirectory: values.get("--data") ?? "runs/optimizer-data/v1",
    outputDirectory: values.get("--out") ?? `runs/optimizer-eval/preflight-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    baseModel: values.get("--base-model") ?? "factory-optimizer-base", tunedModel: values.get("--tuned-model") ?? "factory-optimizer-lora",
    baseUrl: values.get("--base-url") ?? "http://127.0.0.1:8000/v1", provenance,
    live: flags.has("--live"), finalEval: flags.has("--final-eval"), factoryLimit: numeric("--factories", 20), proposalsPerFactory: 3,
    maxModelCalls: numeric("--max-calls", 120), maxTokensPerArm: numeric("--max-tokens-per-arm", 1_000_000), maxSimulationsPerArm: numeric("--max-simulations-per-arm", 480), maxOutputTokens: 128, randomSeed: numeric("--random-seed", 202610173),
  });
  if (plan.live) {
    const url = new URL("/health", plan.baseUrl);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Health check failed with HTTP ${response.status}`);
    const health = validateOptimizerHealth(await response.json(), plan.provenance);
    writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ checkedAt: new Date().toISOString(), url: url.toString(), planHash: contentHash(plan), health }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  const cases = readOptimizerCases(plan);
  const preflight = { factories: cases.length, offeredModelCalls: cases.length * 6, proposalsPerArm: cases.length * 3, maxTokensPerArm: plan.maxTokensPerArm, simulationsPerArm: cases.reduce((sum, item) => sum + item.feedbackDays.length * 4 + item.finalDays.length * 2, 0), maxOutputTokens: plan.maxOutputTokens, live: plan.live, output: plan.outputDirectory };
  writeFileSync(join(plan.outputDirectory, "preflight.json"), JSON.stringify(preflight, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (!plan.live) { console.log(JSON.stringify(preflight, null, 2)); return; }
  if (plan.maxModelCalls < preflight.offeredModelCalls || plan.maxSimulationsPerArm < preflight.simulationsPerArm) throw new Error("Frozen caps cannot cover the offered paired comparison; no requests sent");
  const host = new URL(plan.baseUrl).hostname;
  const apiKey = ["127.0.0.1", "localhost", "[::1]"].includes(host) ? "local" : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("External endpoint requires OPENAI_API_KEY");
  const client = new OpenAI({ apiKey, baseURL: plan.baseUrl, maxRetries: 0, timeout: 90_000 });
  const call: OptimizerCall = async request => {
    const response = await client.chat.completions.create({ model: request.model, messages: request.messages, temperature: request.temperature, max_tokens: request.maxOutputTokens });
    return { content: response.choices[0]?.message.content ?? null, finishReason: response.choices[0]?.finish_reason ?? null, responseId: response.id, usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens } : undefined };
  };
  const report = await runOptimizerEvaluation(plan, cases, call);
  console.log(JSON.stringify({ output: plan.outputDirectory, completed: report.completed, stopped: report.stopped, pairedCases: report.pairedCases, pairedWins: report.pairedWins, overall: report.overall }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Optimizer evaluation failed"); process.exitCode = 1; });
