/**
 * Hard per-run cap on model calls. Every agent call in a run goes through guardedChat, which refuses
 * once the run's cap is reached (retries included), so equal per-arm call maximums are enforced at the
 * point of use, not estimated.
 */
import { chat } from "../llm/crusoe.ts";

export class CallCapError extends Error {}

export function makeCallGuard(underlying: typeof chat) {
  let max: number | null = null;
  let used = 0;
  return {
    setCap(cap: number | null) {
      max = cap;
      used = 0;
    },
    used: () => used,
    call: ((agent, params) => {
      if (max !== null && used >= max) throw new CallCapError(`run call cap reached (${used}/${max})`);
      used++;
      return underlying(agent, params);
    }) as typeof chat,
  };
}

export const runCalls = makeCallGuard(chat);
export const guardedChat = runCalls.call;
