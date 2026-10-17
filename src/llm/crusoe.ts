import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file; rely on the real environment.
}

export const CRUSOE_BASE_URL = "https://api.inference.crusoecloud.com/v1";

/** Defaults from Crusoe's hackathon skill file; confirm with `npm run roundtrip`. */
export const MODELS = {
  super: process.env.MODEL_SUPER ?? "nvidia/Nemotron-3-Super-120B-A12B",
  lightning: process.env.MODEL_LIGHTNING ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
  auditor: process.env.MODEL_AUDITOR ?? "deepseek-ai/Deepseek-V4-Flash",
};

let client: OpenAI | null = null;

export function crusoe(): OpenAI {
  if (!client) {
    const apiKey = process.env.CRUSOE_API_KEY;
    if (!apiKey) throw new Error("CRUSOE_API_KEY is not set. Put it in .env (see .env.example).");
    // The SDK retries 429/503 with exponential backoff; Crusoe caps at 30 RPM per model without a card.
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
  ms: number;
}

/** Every call lands here so the UI can show tokens, cache hit rate, and cost per generation. */
export const usageLedger: UsageRecord[] = [];

type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  /** Crusoe passes this through to the model's chat template (e.g. enable_thinking). */
  chat_template_kwargs?: Record<string, unknown>;
};

export async function chat(agent: string, params: ChatParams): Promise<ChatCompletion> {
  const t0 = Date.now();
  const res = await crusoe().chat.completions.create({ max_tokens: 2048, ...params } as ChatCompletionCreateParamsNonStreaming);
  const u = res.usage;
  usageLedger.push({
    agent,
    model: params.model,
    promptTokens: u?.prompt_tokens ?? 0,
    completionTokens: u?.completion_tokens ?? 0,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
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
