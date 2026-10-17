import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { prepareV2Continuation, runV2Continuation } from "../src/training/optimizer-v2-continuation.ts";
import { validateV2Health, type V2Call, type V2Plan } from "../src/training/optimizer-v2-evaluate.ts";
async function main() {
  const args = process.argv.slice(2), values = new Map<string, string>();
  if (!args.includes("--approve-continuation")) throw new Error("Explicit user-approved --approve-continuation is required");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--approve-continuation") continue;
    if (!["--original", "--out"].includes(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Use --original DIRECTORY --out NEW_DIRECTORY --approve-continuation");
    values.set(args[i], args[++i]);
  }
  const output = values.get("--out"); if (!output) throw new Error("--out is required");
  if (!existsSync(join(output, "continuation-manifest.json"))) {
    if (!values.get("--original")) throw new Error("--original is required for preparation");
    prepareV2Continuation({ originalDirectory: values.get("--original")!, outputDirectory: output, approveContinuation: true });
  }
  const plan: V2Plan = JSON.parse(readFileSync(join(output, "engine/evaluation-plan.json"), "utf8"));
  const response = await fetch(new URL("/health", plan.baseUrl), { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error(`Health HTTP ${response.status}`);
  const health = validateV2Health(await response.json(), plan.provenance!);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(plan.baseUrl).hostname), apiKey = loopback ? "local" : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("External endpoint requires OPENAI_API_KEY");
  const client = new OpenAI({ apiKey, baseURL: plan.baseUrl, maxRetries: 0, timeout: 90_000 });
  const call: V2Call = async request => {
    const response = await client.chat.completions.create({ model: request.model, messages: request.messages, temperature: 0, max_tokens: 128 }, { timeout: request.timeoutMs });
    return { content: response.choices[0]?.message.content ?? null, responseId: response.id, finishReason: response.choices[0]?.finish_reason ?? null, usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens } : undefined };
  };
  const result = await runV2Continuation(output, true, health, call);
  console.log(JSON.stringify({ output, completed: result.completed, primaryFactoryCount: result.primaryFactoryCount, terminalReason: result.terminalReason, accounting: result.accounting }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Continuation failed"); process.exitCode = 1; });
