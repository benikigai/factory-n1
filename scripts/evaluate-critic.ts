import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { freezeEvaluation, isLoopbackEndpoint, readEvaluationCases, runEvaluation, tokenUpperBound, validateLoopbackHealth, type CheckpointProvenance, type ModelCall } from "../src/training/evaluate.ts";
import { criticMessages } from "../src/training/critic.ts";
import { contentHash } from "../src/training/generate.ts";

const HELP = `Usage: npx tsx scripts/evaluate-critic.ts [options]
Default: offline validation preflight; no model calls.
  --data runs/finetune-data/critic-v1
  --out runs/finetune-eval/NAME         Must be a new directory
  --base-model ID --tuned-model ID     Distinct IDs from the same base checkpoint
  --base-url URL                      Shared OpenAI-compatible endpoint
  --provenance FILE                   JSON: baseModel, tunedModel, baseCheckpoint,
                                      tunedBaseCheckpoint, trainingJobId
  --limit 20 --max-calls 40 --max-total-tokens 500000 --max-output-tokens 256
  --live                              Explicitly allow paid/native model calls
  --split test --final-eval            Explicitly open held-out test after freezing plan
For Crusoe use CRUSOE_API_KEY; other endpoints use OPENAI_API_KEY. Loopback defaults to a local placeholder.
No automatic retries. Missing usage or an ambiguous charge stops the comparison.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log(HELP); return; }
  const values = new Map<string, string>(), flags = new Set<string>();
  const allowed = new Set(["--data", "--out", "--base-model", "--tuned-model", "--base-url", "--provenance", "--limit", "--max-calls", "--max-total-tokens", "--max-output-tokens", "--split"]);
  for (let i = 0; i < args.length; i++) {
    if (["--live", "--final-eval"].includes(args[i])) { if (flags.has(args[i])) throw new Error("Repeated flag"); flags.add(args[i]); continue; }
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) throw new Error("Unknown, repeated, or incomplete argument; use --help");
    values.set(args[i], args[++i]);
  }
  const numeric = (key: string, fallback: number) => values.has(key) ? Number(values.get(key)) : fallback;
  const split = values.get("--split") ?? "validation";
  if (split !== "validation" && split !== "test") throw new Error("--split must be validation or test");
  const provenance = values.has("--provenance") ? JSON.parse(readFileSync(values.get("--provenance")!, "utf8")) as CheckpointProvenance : undefined;
  const plan = freezeEvaluation({
    dataDirectory: values.get("--data") ?? "runs/finetune-data/critic-v1",
    outputDirectory: values.get("--out") ?? `runs/finetune-eval/preflight-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    split, finalEval: flags.has("--final-eval"), live: flags.has("--live"),
    baseModel: values.get("--base-model") ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
    tunedModel: values.get("--tuned-model") ?? "adapter-not-configured",
    baseUrl: values.get("--base-url") ?? process.env.CRUSOE_BASE_URL ?? "https://api.inference.crusoecloud.com/v1",
    provenance, limit: numeric("--limit", 20), maxCalls: numeric("--max-calls", 40), maxTotalTokens: numeric("--max-total-tokens", 500_000), maxOutputTokens: numeric("--max-output-tokens", 256),
  });
  if (plan.live && isLoopbackEndpoint(plan.baseUrl)) {
    const healthUrl = new URL("/health", plan.baseUrl).toString();
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`Loopback health check failed with HTTP ${response.status}`);
    const health = validateLoopbackHealth(await response.json(), plan.provenance);
    writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ checkedAt: new Date().toISOString(), url: healthUrl, planHash: contentHash(plan), health }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  const cases = readEvaluationCases(plan);
  const preflight = { examples: cases.length, buildings: new Set(cases.map(item => item.building)).size, plannedCalls: cases.length * 2, worstCaseTokenReservation: cases.reduce((sum, item) => sum + tokenUpperBound(criticMessages(item.input), plan.maxOutputTokens) * 2, 0), live: plan.live, split: plan.split, output: plan.outputDirectory };
  writeFileSync(join(plan.outputDirectory, "preflight.json"), JSON.stringify(preflight, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (!plan.live) { console.log(JSON.stringify(preflight, null, 2)); return; }
  if (preflight.plannedCalls > plan.maxCalls || preflight.worstCaseTokenReservation > plan.maxTotalTokens) throw new Error("Frozen budget cannot cover the complete paired evaluation; no calls sent");
  const host = new URL(plan.baseUrl).hostname;
  const loopback = isLoopbackEndpoint(plan.baseUrl);
  const apiKey = host === "api.inference.crusoecloud.com" ? process.env.CRUSOE_API_KEY : process.env.OPENAI_API_KEY ?? (loopback ? "local" : undefined);
  if (!apiKey) throw new Error("Live endpoint requires its matching environment API key");
  const client = new OpenAI({ apiKey, baseURL: plan.baseUrl, maxRetries: 0, timeout: 90_000 });
  const call: ModelCall = async request => {
    const response = await client.chat.completions.create({ model: request.model, messages: request.messages, temperature: request.temperature, max_tokens: request.maxOutputTokens });
    return { content: response.choices[0]?.message.content ?? null, finishReason: response.choices[0]?.finish_reason ?? null, responseId: response.id,
      usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens } : undefined };
  };
  const report = await runEvaluation(plan, cases, call);
  console.log(JSON.stringify({ output: plan.outputDirectory, completed: report.completed, stopped: report.stopped, pairedCases: report.pairedCases, budget: report.budget, pairedWins: report.pairedWins }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Evaluation failed"); process.exitCode = 1; });
