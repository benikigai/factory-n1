import type { ChatCompletionMessageParam, ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { chat, type ChatParams } from "./crusoe.ts";

export interface AgentTool {
  definition: ChatCompletionFunctionTool;
  /** Must validate untrusted JSON before execute can see it. */
  parse(input: unknown): unknown;
  execute(input: unknown): unknown | Promise<unknown>;
}

export interface ToolReceipt {
  id: string;
  name: string;
  status: "ok" | "unknown_tool" | "invalid_arguments" | "execution_failed" | "budget_exhausted";
  result: unknown;
}

/** No shell, network or file tools are implicit. Only the supplied registry is callable. */
export async function runToolTurn(options: {
  agent: string;
  params: ChatParams;
  tools: AgentTool[];
  maxRounds?: number;
  maxToolCalls?: number;
  call?: typeof chat;
}) {
  const { agent, params, tools, call = chat, maxRounds = 3, maxToolCalls = 4 } = options;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || !Number.isInteger(maxToolCalls) || maxToolCalls < 0) {
    throw new Error("invalid tool turn limits");
  }
  const registry = new Map(tools.map(t => [t.definition.function.name, t]));
  if (registry.size !== tools.length) throw new Error("duplicate tool names");
  const messages: ChatCompletionMessageParam[] = [...params.messages];
  const receipts: ToolReceipt[] = [];
  let calls = 0;
  for (let round = 0; round < maxRounds; round++) {
    const response = await call(agent, { ...params, messages, tools: tools.map(t => t.definition) });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("provider returned no assistant message");
    messages.push(message);
    if (!message.tool_calls?.length) {
      return { content: message.content, receipts, messages, stopped: "completed" as const };
    }
    for (const requested of message.tool_calls) {
      if (requested.type !== "function") {
        throw new Error("custom tool calls are unsupported; use a registered function");
      }
      const tool = registry.get(requested.function.name);
      let status: ToolReceipt["status"] = "ok";
      let result: unknown;
      if (++calls > maxToolCalls) {
        status = "budget_exhausted";
      } else if (!tool) {
        status = "unknown_tool";
      } else {
        let parsed: unknown;
        try { parsed = tool.parse(JSON.parse(requested.function.arguments)); }
        catch { status = "invalid_arguments"; }
        if (status === "ok") {
          try { result = await tool.execute(parsed); }
          catch { status = "execution_failed"; }
        }
      }
      // Do not echo arbitrary exceptions: tools may contain credentials in their errors.
      if (status !== "ok") result = { error: status };
      const receipt = { id: requested.id, name: requested.function.name, status, result };
      receipts.push(receipt);
      messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify(result ?? null) });
    }
    if (calls >= maxToolCalls) return { content: null, receipts, messages, stopped: "tool_budget" as const };
  }
  return { content: null, receipts, messages, stopped: "round_budget" as const };
}
