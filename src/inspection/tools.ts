import type { AgentTool } from "../llm/tools.ts";
import { DEFAULT_DOD } from "../sim/dod.ts";
import { evaluate, summarize, type Evaluation } from "../sim/evaluate.ts";
import { distance } from "../sim/layout.ts";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import type { Layout } from "../sim/types.ts";
import { validateForTask, type Task } from "../tasks/task.ts";

type LayoutId = "baseline" | "champion";
type InspectionSplit = "train" | "select";
type JsonObject = Record<string, unknown>;

export interface InspectionToolOptions {
  task: Task;
  baseline: Layout;
  champion: Layout;
  runId: string;
  expectedGraderHash?: string;
}

const layoutParameter = { type: "string", enum: ["baseline", "champion"] };
const splitParameter = { type: "string", enum: ["train", "select"] };
const meanMetrics = ["shipped", "unshipped", "missorts", "damaged", "makespan", "travelCells", "objective"] as const;
const totalMetrics = ["packages", "shipped", "unshipped", "missorts", "damaged"] as const;

function object(input: unknown, keys: string[]): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("object required");
  const value = input as JsonObject;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error("unexpected or missing arguments");
  }
  return value;
}

function layoutId(value: unknown): LayoutId {
  if (value !== "baseline" && value !== "champion") throw new Error("unknown layout");
  return value;
}

function splitId(value: unknown): InspectionSplit {
  if (value !== "train" && value !== "select") throw new Error("only train and select are available");
  return value;
}

function oneLayout(input: unknown) {
  const value = object(input, ["layout"]);
  return { layout: layoutId(value.layout) };
}

function layoutSplit(input: unknown) {
  const value = object(input, ["layout", "split"]);
  return { layout: layoutId(value.layout), split: splitId(value.split) };
}

function onlySplit(input: unknown) {
  return { split: splitId(object(input, ["split"]).split) };
}

function legsInput(input: unknown) {
  const value = object(input, ["layout", "legs"]);
  if (!Array.isArray(value.legs) || value.legs.length < 1 || value.legs.length > 16) throw new Error("provide 1-16 legs");
  return {
    layout: layoutId(value.layout),
    legs: value.legs.map(leg => {
      const pair = object(leg, ["from", "to"]);
      if (typeof pair.from !== "string" || typeof pair.to !== "string" || !pair.from || !pair.to) throw new Error("station ids required");
      return { from: pair.from, to: pair.to };
    }),
  };
}

function metrics(evaluation: Evaluation) {
  const results = evaluation.results;
  const mean = Object.fromEntries(meanMetrics.map(metric => [metric,
    Math.round(results.reduce((sum, result) => sum + result.metrics[metric], 0) / results.length * 100) / 100,
  ])) as Record<typeof meanMetrics[number], number>;
  return {
    ...summarize(evaluation),
    scenarioCount: results.length,
    mean,
    totals: Object.fromEntries(totalMetrics.map(metric => [metric,
      results.reduce((sum, result) => sum + result.metrics[metric], 0),
    ])),
    worst: {
      minimumShipped: Math.min(...results.map(result => result.metrics.shipped)),
      damaged: Math.max(...results.map(result => result.metrics.damaged)),
      missorts: Math.max(...results.map(result => result.metrics.missorts)),
      makespan: Math.max(...results.map(result => result.metrics.makespan)),
    },
  };
}

/** Read-only inspection of two fixed layouts. No model-provided code, layouts or holdout splits execute. */
export function createInspectionTools(options: InspectionToolOptions): AgentTool[] {
  const task = structuredClone(options.task);
  const layouts = { baseline: structuredClone(options.baseline), champion: structuredClone(options.champion) };
  for (const [id, layout] of Object.entries(layouts)) {
    const errors = validateForTask(layout, task);
    if (errors.length) throw new Error(`${id} is not a valid task layout: ${errors.join("; ")}`);
  }
  const frozenHash = options.expectedGraderHash ?? graderHash();
  const assertGrader = () => {
    if (graderHash() !== frozenHash) throw new Error("grader changed; inspection stopped");
  };
  assertGrader();
  const evidence = () => ({
    runId: options.runId,
    taskId: task.id,
    simVersion: SIM_VERSION,
    graderHash: frozenHash,
    scope: "Read-only inspection of fixed layouts. Train/select are development days; no test or final split is evaluated by these tools.",
  });
  const cache = new Map<string, ReturnType<typeof metrics>>();
  const score = (layout: LayoutId, split: InspectionSplit) => {
    assertGrader();
    const key = `${layout}:${split}`;
    if (!cache.has(key)) cache.set(key, metrics(evaluate(layouts[layout], split, DEFAULT_DOD)));
    return structuredClone(cache.get(key)!);
  };
  function tool<T>(name: string, description: string, properties: JsonObject, parse: (input: unknown) => T, execute: (args: T) => unknown): AgentTool {
    return {
      definition: { type: "function", function: {
        name, description, strict: true,
        parameters: { type: "object", additionalProperties: false, required: Object.keys(properties), properties },
      } },
      parse,
      execute(input) {
        assertGrader();
        // Revalidate at execution too, so direct callers cannot bypass the same bounds.
        return execute(parse(input));
      },
    };
  }
  return [
    tool("get_layout", "Read the immutable baseline or champion station coordinates and task goal.", { layout: layoutParameter }, oneLayout,
      ({ layout }) => ({ evidence: evidence(), layoutId: layout, layout: structuredClone(layouts[layout]), goal: task.goal, fixedStationIds: [...task.fixed] })),
    tool("measure_legs", "Measure 1-16 station pairs in a fixed layout. Uses the frozen simulator's Manhattan cell distance; no obstacle routing or damage prediction.", {
      layout: layoutParameter,
      legs: { type: "array", minItems: 1, maxItems: 16, items: {
        type: "object", additionalProperties: false, required: ["from", "to"],
        properties: { from: { type: "string" }, to: { type: "string" } },
      } },
    }, legsInput, ({ layout, legs }) => {
      const stations = new Map(layouts[layout].stations.map(station => [station.id, station]));
      return { evidence: evidence(), layoutId: layout, method: "sim/layout.ts distance(): Manhattan cells", legs: legs.map(({ from, to }) => {
        const a = stations.get(from), b = stations.get(to);
        if (!a || !b) return { from, to, error: "unknown_station" };
        return { from, to, fromPosition: { x: a.x, y: a.y }, toPosition: { x: b.x, y: b.y }, cells: distance(a, b) };
      }) };
    }),
    tool("evaluate_layout", "Evaluate one fixed layout using the unchanged grader and default goal on train or select development days. No holdout access.", {
      layout: layoutParameter, split: splitParameter,
    }, layoutSplit, ({ layout, split }) => ({ evidence: evidence(), layoutId: layout, evaluation: score(layout, split) })),
    tool("compare_layouts", "Compare baseline and champion on exactly the same train or select days. Reports measured differences, not proof of which edit caused them.", {
      split: splitParameter,
    }, onlySplit, ({ split }) => {
      const baseline = score("baseline", split), champion = score("champion", split);
      return {
        evidence: evidence(), split, baseline, champion,
        deltaMean: Object.fromEntries(meanMetrics.map(metric => [metric, Math.round((champion.mean[metric] - baseline.mean[metric]) * 100) / 100])),
        interpretation: "Deltas are champion minus baseline on development days. This comparison does not establish causal attribution or generalization to fresh factories.",
      };
    }),
  ];
}
