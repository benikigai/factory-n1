import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { CallBudget, type BudgetState } from "./budget.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file; rely on the real environment (e.g. node --env-file=<1Password mount>).
}

export const CRUSOE_BASE_URL = process.env.CRUSOE_BASE_URL ?? "https://api.inference.crusoecloud.com/v1";

/**
 * Lightning's ID is verified live on our account. The others come from Crusoe's
 * docs, whose casing differs from the API; resolveModels() fixes them against /v1/models.
 */
export const MODELS = {
  super: process.env.MODEL_SUPER ?? "nvidia/NVIDIA-Nemotron-3.5-Super-VL",
  lightning: process.env.MODEL_LIGHTNING ?? process.env.CRUSOE_MODEL ?? "nvidia/Nemotron-3.5-Lightning-30B-A3B",
  auditor: process.env.MODEL_AUDITOR ?? "deepseek-ai/Deepseek-V4-Flash",
};

/** Map each configured model to its exact catalog ID (case-insensitive). Unknown roles fall back to Lightning. */
export function resolveModels(catalog: string[]): { missing: string[] } {
  const missing: string[] = [];
  const find = (id: string) => catalog.find((c) => c.toLowerCase() === id.toLowerCase());
  const lightning = find(MODELS.lightning);
  if (!lightning) throw new Error(`required Lightning model missing from catalog: ${MODELS.lightning}`);
  MODELS.lightning = lightning;
  for (const role of ["super", "auditor"] as const) {
    const hit = find(MODELS[role]);
    if (hit) MODELS[role] = hit;
    else {
      missing.push(`${role}: ${MODELS[role]}`);
      MODELS[role] = MODELS.lightning;
    }
  }
  return { missing };
}

/** USD per 1M tokens: input / output / cached input (Crusoe pricing, Oct 2026). */
const PRICES: Record<string, [number, number, number]> = {
  "nemotron-3.5-lightning": [0.05, 0.2, 0.03],
  "nemotron-3-super": [0.3, 2.4, 0.15],
  "nemotron-3.5-super": [0.1, 0.4, 0.08],
  "nemotron-3-nano-30b": [0.05, 0.2, 0.03],
  "deepseek-v4-flash": [0.14, 0.28, 0.03],
  "deepseek-v4-pro": [1.74, 3.48, 0.15],
  "gpt-oss-120b": [0.05, 0.25, 0.05],
  "glm-5.3-flash": [0.15, 0.5, 0.03],
};

export function price(model: string): [number, number, number] {
  const key = Object.keys(PRICES).find((k) => model.toLowerCase().includes(k));
  if (!key) throw new Error(`No verified price for ${model}; add its published rate before calling it`);
  return PRICES[key];
}

/**
 * Per-process spend limits. Defaults suit smoke tests and short runs;
 * raise them explicitly (CALL_BUDGET, SPEND_CAP_USD) for longer loops.
 */
export const LIMITS = {
  calls: Number(process.env.CALL_BUDGET ?? 40),
  usd: Number(process.env.SPEND_CAP_USD ?? 0.5),
};
const budget = new CallBudget(LIMITS);

let client: OpenAI | null = null;

export function crusoe(): OpenAI {
  if (!client) {
    const apiKey = process.env.CRUSOE_API_KEY;
    if (!apiKey) throw new Error("CRUSOE_API_KEY is not set. Launch with node --env-file=<1Password mount> (see README).");
    // An automatic retry can bill a second request after an ambiguous timeout.
    client = new OpenAI({ baseURL: CRUSOE_BASE_URL, apiKey, maxRetries: 0, timeout: 90_000 });
  }
  return client;
}

export interface UsageRecord {
  /** Stable across checkpoint imports; prevents billing history being counted twice. */
  requestId?: string;
  agent: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Prefix-cache hits on Crusoe MemoryAlloy; the Shared Brain cost metric. */
  cachedTokens: number;
  usd: number;
  ms: number;
}

/** Every call lands here so the UI can show tokens, cache hit rate, and cost per generation. */
export const usageLedger: UsageRecord[] = [];

export interface SpendState { budget: BudgetState; usage: UsageRecord[] }
let spendObserver: (() => void) | null = null;
export function setSpendObserver(observer: (() => void) | null) { spendObserver = observer; }

export function spendState(): SpendState {
  for (let i = 0; i < usageLedger.length; i++) usageLedger[i].requestId ??= `${budget.id}:legacy-${i}`;
  return { budget: budget.exportState(), usage: structuredClone(usageLedger) };
}

export function restoreSpend(state: SpendState) {
  const known = new Set(usageLedger.map((u) => u.requestId));
  if (state.usage.some((u) => !u.requestId || !Number.isFinite(u.usd) || u.usd < 0)) throw new Error("invalid checkpoint usage ledger");
  budget.restore(state.budget);
  for (const record of state.usage) {
    if (!known.has(record.requestId)) {
      usageLedger.push(structuredClone(record));
      known.add(record.requestId);
    }
  }
}

export function spend() {
  return {
    calls: budget.snapshot().attempts,
    usd: usageLedger.reduce((a, u) => a + u.usd, 0),
    promptTokens: usageLedger.reduce((a, u) => a + u.promptTokens, 0),
    cachedTokens: usageLedger.reduce((a, u) => a + u.cachedTokens, 0),
    reservedUsd: budget.snapshot().reservedUsd,
  };
}

const MAX_CONTEXT_TOKENS = 1_048_576;
const TEMPLATE_ALLOWANCE_TOKENS = 4_096;

/** Upper bound on input tokens for a request (see chat()). Exported for tests. */
export function inputTokenBound(params: Pick<ChatCompletionCreateParamsNonStreaming, "messages" | "tools">): number {
  const body = JSON.stringify({ messages: params.messages, tools: params.tools ?? [] });
  if (body.includes('"image_url"') || body.includes('"input_audio"')) return MAX_CONTEXT_TOKENS;
  return Math.min(MAX_CONTEXT_TOKENS, Buffer.byteLength(body, "utf8") + TEMPLATE_ALLOWANCE_TOKENS);
}

export type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  /** Crusoe passes this through to the model's chat template (e.g. enable_thinking). */
  chat_template_kwargs?: Record<string, unknown>;
};

export async function chat(agent: string, params: ChatParams): Promise<ChatCompletion> {
  const maxTokens = params.max_completion_tokens ?? params.max_tokens ?? 2048;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 65_536) throw new Error("max output tokens must be 1..65536");
  const [pin, pout, pcache] = price(params.model);
  // Reserve a provable upper bound on billable tokens before dispatch. Byte-level tokenizers emit at most
  // one token per UTF-8 byte, so the request's byte size (messages + tools) plus a chat-template allowance
  // bounds the input for text-only requests. Image inputs fall back to the full 1M-token bound.
  // A failed request keeps this reservation (billing unknown), so the bound must be safe, but it no longer
  // locks ~$0.106 of a small budget per transient network error.
  const reservation = budget.reserve((inputTokenBound(params) * Math.max(pin, pcache) + maxTokens * pout) / 1e6);
  spendObserver?.();
  const t0 = Date.now();
  const res = await crusoe().chat.completions.create({
    ...(params.max_completion_tokens === undefined ? { max_tokens: maxTokens } : {}), ...params,
  } as ChatCompletionCreateParamsNonStreaming);
  const u = res.usage;
  if (!u) throw new Error("Provider omitted usage; request reservation retained because billing is unknown");
  const prompt = u?.prompt_tokens ?? 0;
  const cached = Math.min(prompt, Math.max(0, u?.prompt_tokens_details?.cached_tokens ?? 0));
  const completion = u?.completion_tokens ?? 0;
  const usd = ((prompt - cached) * pin + cached * pcache + completion * pout) / 1e6;
  budget.settle(reservation, usd);
  usageLedger.push({
    requestId: `${budget.id}:${reservation}`,
    agent,
    model: params.model,
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: cached,
    usd,
    ms: Date.now() - t0,
  });
  spendObserver?.();
  return res;
}

/** Pull the first JSON object out of a reply, tolerating code fences and leading prose. */
export function parseJson<T>(text: string | null | undefined): T {
  if (!text) throw new Error("empty model reply (raise max_tokens if the model is reasoning)");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`no JSON object in reply: ${text.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1)) as T;
}
