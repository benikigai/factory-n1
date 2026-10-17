// Live learning run on factory A. Usage (spend caps are explicit and required):
// CALL_BUDGET=40 SPEND_CAP_USD=0.50 node --env-file=<1Password mount> --import tsx scripts/solve.ts [generations] [runId]
import { crusoe, LIMITS, MODELS, resolveModels } from "../src/llm/crusoe.ts";
import { solve } from "../src/loop/solve.ts";
import { loadTaskA } from "../src/tasks/task.ts";

if (!process.env.CALL_BUDGET || !process.env.SPEND_CAP_USD) throw new Error("set CALL_BUDGET and SPEND_CAP_USD explicitly");
const [gens = "5", runId, probes = "0"] = process.argv.slice(2);
resolveModels((await crusoe().models.list()).data.map((m) => m.id));
console.log(`models: ${JSON.stringify(MODELS)} | caps: ${LIMITS.calls} calls, $${LIMITS.usd}`);
const summary = await solve({ task: loadTaskA(), generations: Number(gens), runId, probes: Number(probes) });
console.log(JSON.stringify(summary, null, 2));
console.log(`\nreplay: http://localhost:5173/?run=${summary.runId}`);
