/**
 * Reflector (Super VL). After an accepted change it writes one short lesson. The
 * evidence attached to the lesson is computed by code (edit receipts and select
 * deltas); the model only supplies wording and scope, and is told not to claim causes
 * the receipts don't show.
 */
import { MODELS, parseJson } from "../llm/crusoe.ts";
import { guardedChat as chat } from "./call-guard.ts";
import type { Evidence, MemoryOp } from "../memory/store.ts";
import { retryOn429 } from "./retry.ts";

export async function reflect(opts: {
  id: string;
  evidence: Evidence;
  rationale: string;
  before: Record<string, number>;
  after: Record<string, number>;
  /** "stall": the edits did NOT beat the champion; write what to avoid. */
  outcome?: "accepted" | "stall";
}): Promise<MemoryOp | null> {
  const stall = opts.outcome === "stall";
  const receipts = (opts.evidence.edits ?? []).map((e) => `${e.edit}: ${e.deltaAlone === null ? "invalid alone" : (e.deltaAlone > 0 ? "+" : "") + e.deltaAlone}`).join("\n");
  try {
    const res = await retryOn429(() => chat("reflector", {
      model: MODELS.super,
      max_tokens: 400,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        {
          role: "system",
          content:
            `You write one lesson for a shared factory-layout playbook. Base it ONLY on the code-computed receipts: each edit's objective change when applied alone (negative is better). ${stall ? "These edits were tried and did NOT beat the current champion: write what to avoid or what the data suggests trying instead." : "Do not credit an edit whose receipt is near zero or positive."} Reply with JSON only: {\"lesson\": string (<= 200 chars), \"scope\": string (<= 80 chars)}`,
        },
        {
          role: "user",
          content: `${stall ? `REJECTED change (best of a stalled generation). On the separate validation days it changed the objective by ${opts.evidence.deltaSelect ?? "an unmeasured amount"} (positive is worse), so the gate rejected it; training-day receipts below may not hold up` : `Accepted change (select objective ${opts.evidence.deltaSelect})`}. Designer rationale (may be wrong): ${opts.rationale}\nEdit receipts:\n${receipts}\nAverage metrics before: ${JSON.stringify(opts.before)}\nAfter: ${JSON.stringify(opts.after)}`,
        },
      ],
    }));
    const out = parseJson<{ lesson: string; scope: string }>(res.choices[0]?.message.content);
    if (typeof out.lesson !== "string" || !out.lesson.trim()) return null;
    return { op: "add_verified", id: opts.id, text: out.lesson.slice(0, 220), scope: String(out.scope ?? "").slice(0, 80), evidence: opts.evidence, author: MODELS.super };
  } catch {
    return null;
  }
}
