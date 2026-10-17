import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

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
  if (lightning) MODELS.lightning = lightning;
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
  // Super VL price not yet published by Crusoe; assume Super 3 rates.
  "nemotron-3.5-super": [0.3, 2.4, 0.15],
  "nemotron-3-nano-30b": [0.05, 0.2, 0.03],
  "deepseek-v4-flash": [0.14, 0.28, 0.03],
  "deepseek-v4-pro": [1.74, 3.48, 0.15],
  "gpt-oss-120b": [0.05, 0.2, 0.05],
  "glm-5.3-flash": [0.15, 0.5, 0.03],
};

function price(model: string): [number, number, number] {
  const key = Object.keys(PRICES).find((k) => model.toLowerCase().includes(k));
  // Unknown models are priced like the most expensive one so the cap errs safe.
  return key ? PRICES[key] : [1.74, 3.48, 0.15];
}

/**
 * Hard per-process spend limits. Defaults suit smoke tests and short runs;
 * raise them explicitly (CALL_BUDGET, SPEND_CAP_USD) for longer loops.
 */
export const LIMITS = {
  calls: Number(process.env.CALL_BUDGET ?? 40),
  usd: Number(process.env.SPEND_CAP_USD ?? 0.5),
};

let client: OpenAI | null = null;

export function crusoe(): OpenAI {
  if (!client) {
    const apiKey = process.env.CRUSOE_API_KEY;
    if (!apiKey) throw new Error("CRUSOE_API_KEY is not set. Launch with node --env-file=<1Password mount> (see README).");
    // The SDK retries 429/503 with exponential backoff.
    client = new OpenAI({ baseURL: CRUSOE_BASE_URL, apiKey, maxRetries: 6, timeout: 120_000 });
  }
  return client;
}

export interface UsageRecord {
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

export function spend() {
  return {
    calls: usageLedger.length,
    usd: usageLedger.reduce((a, u) => a + u.usd, 0),
    promptTokens: usageLedger.reduce((a, u) => a + u.promptTokens, 0),
    cachedTokens: usageLedger.reduce((a, u) => a + u.cachedTokens, 0),
  };
}

type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  /** Crusoe passes this through to the model's chat template (e.g. enable_thinking). */
  chat_template_kwargs?: Record<string, unknown>;
};

export async function chat(agent: string, params: ChatParams): Promise<ChatCompletion> {
  const s = spend();
  if (s.calls >= LIMITS.calls || s.usd >= LIMITS.usd) {
    throw new Error(`spend cap reached: ${s.calls}/${LIMITS.calls} calls, $${s.usd.toFixed(4)}/$${LIMITS.usd}`);
  }
  const t0 = Date.now();
  const res = await crusoe().chat.completions.create({ max_tokens: 2048, ...params } as ChatCompletionCreateParamsNonStreaming);
  const u = res.usage;
  const prompt = u?.prompt_tokens ?? 0;
  const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
  const completion = u?.completion_tokens ?? 0;
  const [pin, pout, pcache] = price(params.model);
  usageLedger.push({
    agent,
    model: params.model,
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: cached,
    usd: ((prompt - cached) * pin + cached * pcache + completion * pout) / 1e6,
    ms: Date.now() - t0,
  });
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
