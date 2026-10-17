import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { crusoe, MODELS, resolveModels, spend, usageLedger } from "../src/llm/crusoe.ts";
import { runToolTurn, type AgentTool } from "../src/llm/tools.ts";
import { evaluate, summarize } from "../src/sim/evaluate.ts";
import { validateLayout } from "../src/sim/layout.ts";
import { SIM_VERSION, graderHash } from "../src/sim/version.ts";
import type { Layout } from "../src/sim/types.ts";

// Diagnostic on development train only. This is not the final generalization benchmark.
const baseline: Layout = JSON.parse(await readFile(new URL("../layouts/baseline.json", import.meta.url), "utf8"));
const hash = graderHash();
const baselineScore = summarize(evaluate(baseline, "train"));
const heuristic = structuredClone(baseline);
heuristic.name = "size-coverage-heuristic";
for (const station of heuristic.stations) if (station.kind === "pack") station.sizes = ["S", "M", "L"];
const heuristicScore = summarize(evaluate(heuristic, "train"));
const catalog = await crusoe().models.list();
const resolution = resolveModels(catalog.data.map(m => m.id));
if (resolution.missing.length) throw new Error(`Exact comparison models unavailable: ${resolution.missing.join(", ")}`);
const results = [];
const layoutSchema = {
  type: "object", required: ["layout"], additionalProperties: false,
  properties: { layout: { type: "object", required: ["name", "grid", "stations"], properties: {
    name: { type: "string" }, grid: { type: "object", properties: { w: { type: "integer" }, h: { type: "integer" } } },
    stations: { type: "array", items: { type: "object", required: ["id", "kind", "x", "y"], properties: {
      id: { type: "string" }, kind: { enum: ["receiving", "sorter", "pack", "shipping"] },
      x: { type: "integer" }, y: { type: "integer" },
      zones: { type: "array", items: { enum: ["A", "B", "C"] } },
      sizes: { type: "array", items: { enum: ["S", "M", "L"] } },
    } } },
  } } },
};
const runPath = `runs/provider-check/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(runPath, { recursive: true });
for (const role of ["lightning", "super"] as const) {
  const candidates: { layout: Layout; score: ReturnType<typeof summarize> }[] = [];
  const scoreTool: AgentTool = {
    definition: { type: "function", function: { name: "simulate_layout", description: "Evaluate one complete candidate on development train scenarios. Lower objective is better.", parameters: layoutSchema } },
    parse(input) {
      const layout = (input as { layout?: Layout })?.layout;
      if (!layout || validateLayout(layout).length) throw new Error("invalid layout");
      if (JSON.stringify(layout.grid) !== JSON.stringify(baseline.grid)) throw new Error("grid is fixed");
      const docks = (l: Layout) => l.stations.filter(s => s.kind === "receiving" || s.kind === "shipping");
      if (JSON.stringify(docks(layout)) !== JSON.stringify(docks(baseline))) throw new Error("docks are fixed");
      return layout;
    },
    execute(input) {
      const layout = input as Layout;
      const score = summarize(evaluate(layout, "train"));
      candidates.push({ layout, score });
      return score;
    },
  };
  const start = usageLedger.length;
  const t0 = Date.now();
  let outcome: unknown;
  try {
    outcome = await runToolTurn({ agent: `provider-check-${role}`, tools: [scoreTool], maxRounds: 2, maxToolCalls: 2,
      params: { model: MODELS[role], temperature: 0, max_tokens: 3000,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "system", content: "You optimize a simulated factory. Call simulate_layout once with your best complete candidate, then explain only that observed result. Keep the grid and all receiving/shipping dock records unchanged. Interior stations can change. Coordinates are integers; Chebyshev spacing >=2; 1-2 sorters, 1-8 packs. All pack stations need zones and sizes. Every candidate must support sizes S,M,L and zones A,B,C. Never claim an unexecuted simulation or improvement. Tools are the source of truth." },
          { role: "user", content: JSON.stringify({ baseline, baselineScore, task: "Improve objective while shipping all packages without damage or missorts. Propose a valid complete layout through simulate_layout." }) }],
      },
    });
  } catch (error) {
    outcome = { error: error instanceof Error ? error.name : "unknown" };
  }
  const usage = usageLedger.slice(start);
  results.push({ model: MODELS[role], role, elapsedMs: Date.now() - t0, outcome, candidates,
    improvedOverBaseline: candidates.some(c => c.score.objective < baselineScore.objective),
    improvedOverHeuristic: candidates.some(c => c.score.objective < heuristicScore.objective), usage });
  // Save after each model so a later failure cannot erase useful training examples.
  await writeFile(`${runPath}/result.json`, JSON.stringify({ kind: "live-provider-diagnostic", createdAt: new Date().toISOString(),
    simVersion: SIM_VERSION, graderHash: hash,
    baselineHash: createHash("sha256").update(JSON.stringify(baseline)).digest("hex"),
    split: "train", limitation: "One attempt per model on development scenarios; not a learned-solver or held-out comparison.",
    baselineScore, heuristicScore, results, spend: spend(),
  }, null, 2));
  console.log(JSON.stringify({ role, model: MODELS[role], candidates: candidates.length,
    bestObjective: candidates.length ? Math.min(...candidates.map(c => c.score.objective)) : null,
    heuristicObjective: heuristicScore.objective, usd: usage.reduce((sum, u) => sum + u.usd, 0) }));
}
if (graderHash() !== hash) throw new Error("Grader changed during diagnostic; discard comparison");
console.log(JSON.stringify({ saved: `${runPath}/result.json`, spend: spend() }));
