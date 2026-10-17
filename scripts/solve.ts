// Live learning run on factory A. Usage (spend caps are explicit and required):
// CALL_BUDGET=40 SPEND_CAP_USD=0.50 node --env-file=<1Password mount> --import tsx scripts/solve.ts [generations] [runId]
import { readFileSync } from "node:fs";
import { crusoe, LIMITS, MODELS, resolveModels } from "../src/llm/crusoe.ts";
import { ALL_LENSES } from "../src/agents/designer.ts";
import { solve } from "../src/loop/solve.ts";
import { loadTaskA } from "../src/tasks/task.ts";

if (!process.env.CALL_BUDGET || !process.env.SPEND_CAP_USD) throw new Error("set CALL_BUDGET and SPEND_CAP_USD explicitly");
const [gens = "5", runId, probes = "0"] = process.argv.slice(2);
resolveModels((await crusoe().models.list()).data.map((m) => m.id));
console.log(`models: designers+reflector ${MODELS.super}, research+tests ${MODELS.lightning} | caps: ${LIMITS.calls} calls, $${LIMITS.usd}`);
// START_FROM_RUN=<runId>: continue from that run's champion and shared memory (Version N+1 across runs).
const from = process.env.START_FROM_RUN;
const startFrom = from ? { runId: from, layout: JSON.parse(readFileSync(`runs/${from}/champion.json`, "utf8")) } : undefined;
const initialOps = from ? JSON.parse(readFileSync(`runs/${from}/memory.json`, "utf8")).ops : undefined;
if (from) console.log(`continuing from ${from}: champion + ${initialOps.length} memory ops`);
// LENSES=flow,quality,route: choose the designer lens set (solver policy) for this run.
const lenses = process.env.LENSES ? process.env.LENSES.split(",").map((id) => ALL_LENSES.find((l) => l.id === id)!).filter(Boolean) : undefined;
// NO_RESEARCH=1 skips You.com research and isolated tests for this run.
const summary = await solve({ lenses, research: process.env.NO_RESEARCH !== "1", task: loadTaskA(), generations: Number(gens), runId, probes: Number(probes), sequentialDesigners: process.env.SEQUENTIAL_DESIGNERS === "1", startFrom, initialOps });
console.log(JSON.stringify(summary, null, 2));
console.log(`\nreplay: http://localhost:5173/?run=${summary.runId}`);
