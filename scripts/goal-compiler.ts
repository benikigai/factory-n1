// Offline evidence: node --import tsx scripts/goal-compiler.ts --offline [output.json]
// Live, exactly one two-goal round: CALL_BUDGET=8 SPEND_CAP_USD=0.05 node --env-file=<1Password mount> --import tsx scripts/goal-compiler.ts --live [output.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { AUDITOR_MODEL } from "../src/agents/auditor.ts";
import { PLANNER_MODEL, type GoalChat } from "../src/agents/planner.ts";
import { runCalls } from "../src/agents/call-guard.ts";
import { compileGoal, type GoalCompilation } from "../src/dod/compiler.ts";
import { crusoe, LIMITS, spend, usageLedger } from "../src/llm/crusoe.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { scenariosFor } from "../src/sim/scenarios.ts";
import { loadTaskA } from "../src/tasks/task.ts";

const [mode = "--offline", output] = process.argv.slice(2);
if (!["--offline", "--live"].includes(mode)) throw new Error("usage: goal-compiler.ts --offline|--live [output.json]");
const live = mode === "--live";
const destination = output ?? `docs/evidence/goal-compiler.${live ? "live" : "offline"}.json`;
if (live) {
  if (!process.env.CALL_BUDGET || !process.env.SPEND_CAP_USD || LIMITS.calls > 8 || LIMITS.usd > 0.05) throw new Error("live round requires explicit CALL_BUDGET<=8 SPEND_CAP_USD<=0.05");
  const catalog = (await crusoe().models.list()).data.map((m) => m.id);
  for (const model of [PLANNER_MODEL, AUDITOR_MODEL]) if (!catalog.includes(model)) throw new Error(`required exact model missing: ${model}; no fallback permitted`);
  runCalls.setCap(LIMITS.calls);
}
const impossible = { goal: "Ship all 100 packages within 1 second.", checks: [{ id: "makespan", description: "Ship within one second", metric: "makespan" as const, op: "<=" as const, value: 1, scope: "every" as const }] };
let mockedCalls = 0;
const call: GoalChat | undefined = live ? undefined : async (agent, params) => {
  mockedCalls++;
  const latestGoal = [...params.messages].reverse().find((m) => m.role === "user")?.content;
  const reply = agent === "goal-auditor"
    ? { verdict: "approve", reasons: ["Mock audit: original numeric, quality, and every-scenario requirements are preserved."] }
    : typeof latestGoal === "string" && latestGoal.includes("1 second") ? impossible : DEFAULT_DOD;
  return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] } as ChatCompletion;
};
const results: GoalCompilation[] = [];
for (const goal of [DEFAULT_DOD.goal, impossible.goal]) {
  const result = await compileGoal({ goal, task: loadTaskA(), scenarios: scenariosFor("train"), call });
  results.push(result);
  console.log(`${result.status}: ${goal}${result.approved ? ` [${result.approved.hash}]` : ""}`);
}
const evidence = {
  schemaVersion: 1, kind: "goal-compiler-round", mode: live ? "live" : "offline",
  generatedAt: new Date().toISOString(), scenarioSplit: "train", taskId: "factory-a",
  results, spend: live ? spend() : { calls: 0, mockedCalls, usd: 0, promptTokens: 0, cachedTokens: 0, reservedUsd: 0 },
  usage: live ? usageLedger : [],
  notes: ["An approved DoD preserves the audited goal and passes necessary bounds; it does not establish that a layout achieves it.", "An infeasible goal stops before the auditor and includes a model-independent proof.", live ? "One live round; exact model IDs verified against the provider catalog before inference." : "Recorded offline demonstration with mocked model responses; no provider calls made."],
};
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(evidence, null, 2) + "\n");
console.log(`evidence: ${destination}`);
console.log(JSON.stringify(evidence.spend));
if (results[0].status !== "approved" || results[1].status !== "escalate") process.exitCode = 1;
