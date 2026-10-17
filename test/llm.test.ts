import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { CallBudget } from "../src/llm/budget.ts";
import { price, type ChatParams } from "../src/llm/crusoe.ts";
import { runToolTurn, type AgentTool } from "../src/llm/tools.ts";

test("concurrent work cannot reserve the same remaining budget twice", async () => {
  const budget = new CallBudget({ calls: 4, usd: 0.1 });
  const attempts = await Promise.allSettled([0, 1, 2].map(async () => budget.reserve(0.06)));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  assert.equal(budget.snapshot().reservedUsd, 0.06);
  // An uncertain failed request retains its reservation. A confirmed response settles it.
  assert.throws(() => budget.reserve(0.05), /spend cap/);
  budget.settle(1, 0.001);
  assert.equal(budget.reserve(0.06), 2);
});

test("attempt cap, invalid configuration and double settlement fail closed", () => {
  assert.throws(() => new CallBudget({ calls: NaN, usd: 1 }));
  const budget = new CallBudget({ calls: 1, usd: 1 });
  const id = budget.reserve(0.5);
  budget.settle(id, 0.01);
  assert.throws(() => budget.settle(id, 0.01));
  assert.throws(() => budget.reserve(0.1), /spend cap/);
});

test("published Super VL and Lightning prices are distinct", () => {
  assert.deepEqual(price("nvidia/NVIDIA-Nemotron-3.5-Super-VL"), [0.1, 0.4, 0.08]);
  assert.deepEqual(price("nvidia/Nemotron-3.5-Lightning-30B-A3B"), [0.05, 0.2, 0.03]);
  assert.throws(() => price("unknown-model"), /No verified price/);
});

const reply = (calls?: { name: string; args: string; id: string }[]): ChatCompletion => ({
  id: "fixture", model: "fixture", object: "chat.completion", created: 0,
  choices: [{ index: 0, logprobs: null, finish_reason: calls ? "tool_calls" : "stop", message: {
    role: "assistant", content: calls ? null : "Finished from actual tool results", refusal: null,
    ...(calls ? { tool_calls: calls.map(c => ({ id: c.id, type: "function" as const,
      function: { name: c.name, arguments: c.args } })) } : {}),
  } }],
});

test("malformed and unknown tools never execute, and receipts bind each result", async () => {
  let executions = 0;
  const tool: AgentTool = {
    definition: { type: "function", function: { name: "score", parameters: { type: "object" } } },
    parse(input) { if ((input as { split?: string }).split !== "train") throw new Error("train only"); return input; },
    execute() { executions++; return { objective: 42 }; },
  };
  let turn = 0;
  const result = await runToolTurn({ agent: "fixture", params: { model: "fixture", messages: [] }, tools: [tool], maxToolCalls: 5,
    call: async (_agent, params: ChatParams) => {
      if (turn++ === 0) return reply([
        { id: "1", name: "score", args: "not json" },
        { id: "2", name: "score", args: '{"split":"final"}' },
        { id: "3", name: "shell", args: "{}" },
        { id: "4", name: "score", args: '{"split":"train"}' },
      ]);
      assert.deepEqual(params.messages.filter(m => m.role === "tool").map(m => m.tool_call_id), ["1", "2", "3", "4"]);
      return reply();
    },
  });
  assert.equal(executions, 1);
  assert.deepEqual(result.receipts.map(r => r.status), ["invalid_arguments", "invalid_arguments", "unknown_tool", "ok"]);
  assert.equal(result.stopped, "completed");
});

test("tool budget blocks extra operations and errors do not expose tool internals", async () => {
  let executions = 0;
  const result = await runToolTurn({ agent: "fixture", params: { model: "fixture", messages: [] }, maxToolCalls: 1,
    tools: [{ definition: { type: "function", function: { name: "score" } }, parse: x => x,
      execute() { executions++; throw new Error("secret credential from dependency"); } }],
    call: async () => reply([{ id: "1", name: "score", args: "{}" }, { id: "2", name: "score", args: "{}" }]),
  });
  assert.equal(executions, 1);
  assert.deepEqual(result.receipts.map(r => r.status), ["execution_failed", "budget_exhausted"]);
  assert.doesNotMatch(JSON.stringify(result), /secret credential/);
});

test("input token bound is the request's UTF-8 bytes plus template allowance; images use the full context", async () => {
  const { inputTokenBound } = await import("../src/llm/crusoe.ts");
  const text = { messages: [{ role: "user" as const, content: "héllo".repeat(100) }] };
  const bytes = Buffer.byteLength(JSON.stringify({ messages: text.messages, tools: [] }), "utf8");
  assert.equal(inputTokenBound(text), bytes + 4096);
  const image = { messages: [{ role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } }] }] };
  assert.equal(inputTokenBound(image as never), 1_048_576);
});
