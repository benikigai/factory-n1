import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { guardedChat } from "./call-guard.ts";
import { parseJson, type chat } from "../llm/crusoe.ts";
import { DEFINITION_SCHEMA, definitionErrors } from "../dod/schema.ts";
import type { DefinitionOfDone } from "../sim/dod.ts";

export const PLANNER_MODEL = "nvidia/NVIDIA-Nemotron-3.5-Super-VL";
export type GoalChat = typeof chat;
export interface PlanResult { dod: DefinitionOfDone | null; attempts: number; errors: string[] }

export async function planGoal(opts: {
  goal: string;
  context: string;
  call?: GoalChat;
  validate?: (dod: DefinitionOfDone) => string[];
}): Promise<PlanResult> {
  const call = opts.call ?? guardedChat;
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `Compile the user's one-line factory goal into executable grader checks. Return ONLY JSON matching this schema: ${JSON.stringify(DEFINITION_SCHEMA)}. Preserve the goal exactly. Times are seconds; capex is USD; counts are package counts. Makespan is elapsed time from first arrival to last shipment. Use scope every unless the user explicitly asks for an average. Encode every requested numeric and quality bound exactly, including zero damage and mis-sort limits. Do not weaken impossible goals: code will escalate them with a proof. Do not invent a target the user did not request. Code always adds unshipped == 0 on every scenario, so omit that redundant check. Do not use identity metrics or trivially true checks. ${opts.context}` },
    { role: "user", content: opts.goal },
  ];
  let errors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let content: string | null = null;
    try {
      const response = await call("goal-planner", { model: PLANNER_MODEL, messages, max_tokens: 1600, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
      content = response.choices[0]?.message.content ?? null;
    } catch (e) {
      // Transport, budget, and model-catalog failures do not become unmetered retries.
      return { dod: null, attempts: attempt, errors: [e instanceof Error ? e.message : String(e)] };
    }
    try {
      const candidate = parseJson<unknown>(content);
      errors = definitionErrors(candidate, opts.goal);
      if (!errors.length) errors = opts.validate?.(candidate as DefinitionOfDone) ?? [];
      if (!errors.length) return { dod: candidate as DefinitionOfDone, attempts: attempt, errors: [] };
    } catch (e) {
      errors = [e instanceof Error ? e.message : String(e)];
    }
    if (attempt === 1) messages.push({ role: "assistant", content: content ?? "" }, { role: "user", content: `Repair the JSON once. Preserve every requirement in the original goal. Validation errors: ${errors.join("; ")}` });
  }
  return { dod: null, attempts: 2, errors };
}
