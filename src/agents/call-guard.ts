/**
 * Hard per-run cap on model calls. Every agent call in a run goes through guardedChat, which refuses
 * once the run's cap is reached (retries included), so equal per-arm call maximums are enforced at the
 * point of use, not estimated.
 */
import { chat } from "../llm/crusoe.ts";

export class CallCapError extends Error {}

export interface CallGuardState { cap: number | null; used: number }

export function makeCallGuard(underlying: typeof chat) {
  let max: number | null = null;
  let used = 0;
  let observer: (() => void) | null = null;
  return {
    observe(next: (() => void) | null) { observer = next; },
    setCap(cap: number | null) {
      max = cap;
      used = 0;
    },
    used: () => used,
    snapshot: (): CallGuardState => ({ cap: max, used }),
    restore(state: CallGuardState) {
      if (state.cap !== max) throw new Error("checkpoint call cap differs from this run");
      if (!Number.isInteger(state.used) || state.used < 0 || (max !== null && state.used > max)) throw new Error("invalid checkpoint call count");
      used = state.used;
    },
    call: ((agent, params) => {
      if (max !== null && used >= max) throw new CallCapError(`run call cap reached (${used}/${max})`);
      used++;
      observer?.();
      return underlying(agent, params);
    }) as typeof chat,
  };
}

export const runCalls = makeCallGuard(chat);
export const guardedChat = runCalls.call;
