import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { contentHash } from "../src/training/generate.ts";
import { assertV2Plan, freezeV2Evaluation, readV2Cases, runV2Evaluation, validateV2Health, type V2Plan, type V2Health, type V2Call } from "../src/training/optimizer-v2-evaluate.ts";
const HELP = `Usage: npx tsx scripts/evaluate-optimizer-v2.ts --final-eval [--live] [options]
  --data runs/optimizer-data/v2 --out runs/optimizer-eval/v2-NAME
  --base-url http://127.0.0.1:8000/v1 --provenance comparison-provenance.json
  --factories 20 --max-calls 960 --max-tokens-per-arm 4000000
  --max-simulations-per-arm 1280 --max-runtime-minutes 30 --random-seed 202610174
  --resume DIRECTORY   Reuse the exact frozen plan and durable request receipts.
Four aliases are fixed: factory-optimizer-base, factory-optimizer-v1,
factory-optimizer-old3, factory-optimizer-v2. Each receives 12 proposals/factory.
All requests use 128 output tokens, temperature 0, and no automatic retry.
A resolved response can resume before its local application; an unresolved request
ends the comparison without another model dispatch. Final demands remain hidden
until every search ends. The geometric teacher is a separately labeled planner.`;
async function main() {
  const args = process.argv.slice(2); if (args.includes("--help")) { console.log(HELP); return; }
  const options = new Map<string, string>(), flags = new Set<string>();
  const allowed = new Set(["--data", "--out", "--base-url", "--provenance", "--factories", "--max-calls", "--max-tokens-per-arm", "--max-simulations-per-arm", "--max-runtime-minutes", "--random-seed", "--resume"]);
  for (let i = 0; i < args.length; i++) {
    if (["--live", "--final-eval"].includes(args[i])) { if (flags.has(args[i])) throw new Error("Duplicate flag"); flags.add(args[i]); continue; }
    if (!allowed.has(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown, repeated or missing option; use --help");
    options.set(args[i], args[++i]);
  }
  const number = (key: string, fallback: number) => options.has(key) ? Number(options.get(key)) : fallback;
  let plan: V2Plan;
  if (options.has("--resume")) {
    if (options.size !== 1 || !flags.has("--live") || !flags.has("--final-eval")) throw new Error("Resume accepts only --resume DIRECTORY --live --final-eval; frozen settings cannot change");
    plan = JSON.parse(readFileSync(join(options.get("--resume")!, "evaluation-plan.json"), "utf8")); assertV2Plan(plan);
  } else plan = freezeV2Evaluation({
    dataDirectory: options.get("--data") ?? "runs/optimizer-data/v2", outputDirectory: options.get("--out") ?? `runs/optimizer-eval/v2-${Date.now()}`,
    baseUrl: options.get("--base-url") ?? "http://127.0.0.1:8000/v1", provenance: options.has("--provenance") ? JSON.parse(readFileSync(options.get("--provenance")!, "utf8")) as V2Health : undefined,
    live: flags.has("--live"), finalEval: flags.has("--final-eval"), factoryLimit: number("--factories", 20), maxModelCalls: number("--max-calls", 960), maxTokensPerArm: number("--max-tokens-per-arm", 4_000_000), maxSimulationsPerArm: number("--max-simulations-per-arm", 1280), maxRuntimeMs: number("--max-runtime-minutes", 30) * 60_000, randomSeed: number("--random-seed", 202610174),
  });
  if (plan.live) {
    const response = await fetch(new URL("/health", plan.baseUrl), { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Health failed with HTTP ${response.status}`);
    const health = validateV2Health(await response.json(), plan.provenance!);
    writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ planHash: contentHash(plan), health, checkedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  }
  const cases = readV2Cases(plan);
  if (!plan.live) { console.log(JSON.stringify({ mode: "offline-preflight", factories: cases.length, maxCalls: cases.length * 48, maxOutputTokens: 128, output: plan.outputDirectory }, null, 2)); return; }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(plan.baseUrl).hostname), apiKey = loopback ? "local" : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("External endpoint requires OPENAI_API_KEY");
  const client = new OpenAI({ apiKey, baseURL: plan.baseUrl, maxRetries: 0, timeout: 90_000 });
  const call: V2Call = async request => {
    const response = await client.chat.completions.create({ model: request.model, messages: request.messages, temperature: 0, max_tokens: 128 }, { timeout: request.timeoutMs });
    return { content: response.choices[0]?.message.content ?? null, finishReason: response.choices[0]?.finish_reason ?? null, responseId: response.id, usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens } : undefined };
  };
  const report = await runV2Evaluation(plan, cases, call);
  console.log(JSON.stringify({ output: plan.outputDirectory, completed: report.completed, terminalReason: report.terminalReason, elapsedMs: report.elapsedMs, overall: Object.fromEntries(Object.entries(report.overall).map(([arm, value]: [string, any]) => [arm, { ...value, planningReceipts: undefined }])) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "V2 evaluation failed"); process.exitCode = 1; });
