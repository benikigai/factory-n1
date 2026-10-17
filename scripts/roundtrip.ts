// Proves the Crusoe path end to end: list models, plain chat, and a real tool
// call where the model asks our simulator for metrics and reasons over them.
import { readFileSync } from "node:fs";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { MODELS, chat, crusoe, usageLedger } from "../src/llm/crusoe.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { evaluate, summarize } from "../src/sim/evaluate.ts";
import type { Layout } from "../src/sim/types.ts";

const step = (s: string) => console.log(`\n── ${s}`);

step("GET /v1/models");
const ids: string[] = [];
for await (const m of crusoe().models.list()) ids.push(m.id);
console.log(`${ids.length} models. NVIDIA:`, ids.filter((id) => /nemotron|nvidia/i.test(id)));
const superVl = ids.find((id) => /nemotron.*3\.5.*super/i.test(id));
console.log(superVl ? `Nemotron 3.5 Super is on Crusoe: ${superVl}` : "Nemotron 3.5 Super is NOT listed on Crusoe; using fallback.");
for (const [role, id] of Object.entries(MODELS)) {
  console.log(`  ${role.padEnd(9)} ${id} ${ids.includes(id) ? "✓" : "✗ not found, set MODEL_" + role.toUpperCase()}`);
}

step(`chat on ${MODELS.lightning}`);
const hello = await chat("roundtrip", {
  model: MODELS.lightning,
  messages: [{ role: "user", content: "Reply with exactly: factory online" }],
  chat_template_kwargs: { enable_thinking: false },
});
console.log(hello.choices[0].message.content, hello.choices[0].finish_reason);

step(`tool call on ${MODELS.super}`);
const baseline = JSON.parse(readFileSync("layouts/baseline.json", "utf8")) as Layout;
const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "simulate_layout",
      description: "Run the warehouse simulator on the current layout for a scenario split and return metrics and definition-of-done results.",
      parameters: {
        type: "object",
        properties: { split: { type: "string", enum: ["train"] } },
        required: ["split"],
      },
    },
  },
];
const messages: ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: "You are a fulfillment-center layout engineer. Use the simulator tool before answering. Be brief.",
  },
  {
    role: "user",
    content: `Here is our floor layout:\n${JSON.stringify(baseline)}\nWhy does it fail its definition of done, and what is the single most valuable change?`,
  },
];
const first = await chat("roundtrip", { model: MODELS.super, messages, tools, max_tokens: 4096 });
const call = first.choices[0].message.tool_calls?.[0];
if (!call || call.type !== "function") {
  console.log("✗ model did not call the tool. Reply:", first.choices[0].message.content);
  process.exit(1);
}
console.log("✓ model called", call.function.name, call.function.arguments);
// Crusoe requires the assistant tool_calls turn before the tool result.
messages.push(first.choices[0].message);
const result = summarize(evaluate(baseline, "train", DEFAULT_DOD));
messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
const second = await chat("roundtrip", { model: MODELS.super, messages, tools, max_tokens: 4096 });
console.log(second.choices[0].message.content);

step("usage");
console.table(usageLedger);
