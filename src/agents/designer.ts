/**
 * Nemotron designer. Submits one layout through the typed `propose_layout` tool.
 * The tool only validates task rules; it never scores. Scoring is done afterwards by
 * the frozen grader, so every proposal costs exactly one evaluation.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { MODELS, parseJson } from "../llm/crusoe.ts";
import { runToolTurn, type AgentTool } from "../llm/tools.ts";
import type { Layout } from "../sim/types.ts";
import { validateForTask, type Task } from "../tasks/task.ts";
import { DEFAULT_DOD } from "../sim/dod.ts";
import { meteredEvaluate } from "../loop/meter.ts";
import { observe } from "../loop/observe.ts";
import { retryOn429 } from "./retry.ts";
import { legsAt, moved, possibleLegs } from "./legs.ts";
import { schemaErrors } from "../sim/layout.ts";
import { guardedChat } from "./call-guard.ts";

export interface Prediction {
  objective?: number;
  missorts?: number;
  damaged?: number;
  makespan?: number;
}

export interface Proposal {
  designer: string;
  model: string;
  rationale: string;
  appliedLessons: string[];
  prediction: Prediction;
  layout: Layout | null;
  errors: string[];
  /** How the layout arrived: tool call, after a repair, from text fallback, or not at all. */
  via: "tool" | "tool_after_repair" | "text_fallback" | "failed";
  toolReceipts: { id: string; name: string; status: string }[];
  /** Draft layouts the designer tested with simulate_layout before submitting (each costs one sim eval). */
  probes: { objective: number | null; errors: string[] }[];
}

/** Bounded test tool: run a draft through the frozen simulator on the training days. */
function probeTool(task: Task, budget: number, used: Proposal["probes"]): AgentTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "simulate_layout",
        description: `Test a draft layout on the training days before submitting. Returns per-day results, station load and conveyor-route observations. You have ${budget} tests per turn; each one costs evaluation budget.`,
        parameters: {
          type: "object",
          required: ["layout"],
          properties: { layout: { type: "object", description: "A complete layout in the same format as propose_layout." } },
        },
      },
    },
    parse(input) {
      const v = input as { layout?: unknown };
      if (!v || typeof v !== "object" || !v.layout || typeof v.layout !== "object") throw new Error("layout required");
      return v.layout;
    },
    execute(input) {
      const layout = input as Layout;
      if (used.length >= budget) return { error: "test budget used up; submit your best layout with propose_layout now" };
      const errors = validateForTask(layout, task);
      if (errors.length) {
        used.push({ objective: null, errors });
        return { ok: false, errors };
      }
      const ev = meteredEvaluate("probe", layout, "train", DEFAULT_DOD);
      used.push({ objective: ev.objective, errors: [] });
      return { ok: true, testsLeft: budget - used.length, observation: observe(ev) };
    },
  };
}

/** Free ruler: leg lengths for a draft, and optionally one station's legs at candidate cells. No simulator run. */
export function rulerTool(task: Task, budget: number, used: { n: number }): AgentTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "measure_legs",
        description: `Free, deterministic ruler (no simulator run, no evaluation budget). Lists every conveyor leg in a layout with its length in cells (|dx|+|dy|, the distance packages travel), longest first. Optionally pass one station id and up to 40 candidate cells to see that station's in and out legs at each cell, and whether the moved layout is valid. Use it instead of computing distances by hand. ${budget} uses per turn.`,
        parameters: {
          type: "object",
          required: ["layout"],
          properties: {
            layout: { type: "object", description: "A complete layout in the same format as propose_layout." },
            station: { type: "string", description: "Optional: id of one station to try at the candidate cells." },
            cells: { type: "array", items: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } } }, description: "Optional: candidate cells for that station (max 40)." },
          },
        },
      },
    },
    parse(input) {
      const v = input as { layout?: unknown; station?: unknown; cells?: unknown };
      if (!v || typeof v !== "object" || !v.layout || typeof v.layout !== "object") throw new Error("layout required");
      return v;
    },
    execute(input) {
      const v = input as { layout: Layout; station?: string; cells?: { x: number; y: number }[] };
      if (used.n >= budget) return { error: "ruler uses spent; submit with propose_layout" };
      used.n++;
      const shape = schemaErrors(v.layout);
      if (shape.length) return { ok: false, errors: shape };
      const fmt = (l: { from: string; to: string; cells: number }) => `${l.from}->${l.to} ${l.cells}`;
      const out: Record<string, unknown> = { legs: possibleLegs(v.layout).map(fmt) };
      if (v.station && Array.isArray(v.cells)) {
        if (!v.layout.stations.some((s) => s.id === v.station)) return { ...out, error: `no station ${v.station}` };
        const cells = v.cells.filter((c) => Number.isInteger(c?.x) && Number.isInteger(c?.y)).slice(0, 40);
        out.candidates = legsAt(v.layout, v.station, cells).map((c) => {
          const errors = validateForTask(moved(v.layout, v.station!, c.x, c.y), task);
          return { cell: [c.x, c.y], valid: !errors.length, ...(errors.length ? { why: errors[0] } : {}), legs: c.legs.map(fmt), longest: c.longest };
        });
      }
      return out;
    },
  };
}

export interface Lens {
  id: string;
  instructions: string;
  temperature?: number;
}

/** Default lens set (the route fixer is opt-in via solve({ lenses })). */
export const ALL_LENSES: Lens[] = [
  { id: "flow", temperature: 0.3, instructions: "Your lens is FLOW: shorten and straighten the path each package travels from receiving to its shipping dock, and spread load so no station queue explodes." },
  { id: "quality", temperature: 0.5, instructions: "Your lens is QUALITY: eliminate damaged and mis-sorted packages entirely. Use the arrival-inspection data to find which conveyor routes damage packages, and redesign so no package has to travel such a route (for example, dedicate pack stations to zones and place them where both the sorter and their dock are close). Keep every package shipped." },
  { id: "route", temperature: 0.4, instructions: "Your lens is ROUTE FIXER. From the inspection data, compute L = the length of the longest route that shows zero damage. A station has legs IN and OUT (receiving->sorter, sorter->pack, pack->dock): moving a station changes both. Change as little as possible so that EVERY leg in the layout is at most L cells, especially the ones currently damaging packages. Before submitting, use simulate_layout and confirm the damage count actually dropped; if damage only moved to another leg, try a position between the two endpoints." },
  { id: "capacity", temperature: 0.8, instructions: "Your lens is CAPACITY and COVERAGE: make sure every package type has a pack station that accepts it, size the number of sorters and pack stations to the arrival rate, and watch capex." },
];

export const LENSES: Lens[] = ALL_LENSES.filter((l) => l.id !== "route");

function proposeTool(task: Task, sink: { last?: { args: any; errors: string[] } }): AgentTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "propose_layout",
        description: "Submit one complete floor layout for evaluation by the factory simulator. Returns validation errors if the layout breaks a rule.",
        parameters: {
          type: "object",
          required: ["rationale", "appliedLessons", "prediction", "layout"],
          properties: {
            rationale: { type: "string", description: "Why this change should help, in 1-3 sentences." },
            appliedLessons: { type: "array", items: { type: "string" }, description: "Playbook lesson ids this proposal relies on (may be empty)." },
            prediction: {
              type: "object",
              description: "Your forecast of the simulator's average results on the training days.",
              properties: { objective: { type: "number" }, missorts: { type: "number" }, damaged: { type: "number" }, makespan: { type: "number" } },
            },
            layout: {
              type: "object",
              required: ["name", "grid", "stations"],
              properties: {
                name: { type: "string" },
                grid: { type: "object", properties: { w: { type: "integer" }, h: { type: "integer" } } },
                stations: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "kind", "x", "y"],
                    properties: {
                      id: { type: "string" },
                      kind: { type: "string", enum: ["receiving", "sorter", "pack", "shipping"] },
                      x: { type: "integer" },
                      y: { type: "integer" },
                      zones: { type: "array", items: { type: "string", enum: ["A", "B", "C"] } },
                      sizes: { type: "array", items: { type: "string", enum: ["S", "M", "L"] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    parse(input) {
      const v = input as { layout?: unknown };
      if (!v || typeof v !== "object" || !v.layout || typeof v.layout !== "object") throw new Error("layout required");
      return v;
    },
    execute(input) {
      const args = input as { layout: Layout };
      const errors = validateForTask(args.layout, task);
      sink.last = { args, errors };
      return errors.length
        ? { ok: false, errors, instruction: "Fix every error and call propose_layout again with the full corrected layout." }
        : { ok: true, message: "Layout accepted for evaluation. The simulator will score it after this turn." };
    },
  };
}

export async function propose(opts: {
  task: Task;
  lens: Lens;
  sharedPrefix: string;
  state: string;
  model?: string;
  /** Draft tests allowed before submitting (0 = submit blind). */
  probes?: number;
  /** Free measure_legs ruler uses per turn (0 = no ruler). */
  ruler?: number;
}): Promise<Proposal> {
  const model = opts.model ?? MODELS.super;
  const sink: { last?: { args: any; errors: string[] } } = {};
  const tool = proposeTool(opts.task, sink);
  const receipts: Proposal["toolReceipts"] = [];
  const probes = opts.probes ?? 0;
  const probesUsed: Proposal["probes"] = [];
  const ruler = opts.ruler ?? 0;
  const rulerUsed = { n: 0 };
  const multi = probes > 0 || ruler > 0;
  let proposeCalls = 0;
  const countingTool: AgentTool = { ...tool, execute: (x) => (proposeCalls++, tool.execute(x)) };
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: opts.sharedPrefix },
    { role: "user", content: `${opts.lens.instructions}\n\n${opts.state}\n\n${ruler ? `Use the free measure_legs ruler (up to ${ruler} times) to measure leg lengths and candidate cells instead of computing them by hand. ` : ""}${probes ? `You may test up to ${probes} draft layouts with simulate_layout first, then submit. ` : ""}If your change follows a SHARED PLAYBOOK item, list its id in appliedLessons. Predict the simulator result honestly; your prediction is checked. Never resubmit the champion unchanged: if your tests found nothing better, submit your most promising untested idea. The validation gate protects the factory from bad changes. Call propose_layout exactly once with your best complete layout.` },
  ];
  const turn = (msgs: ChatCompletionMessageParam[]) =>
    retryOn429(() => runToolTurn({
      agent: `designer:${opts.lens.id}`,
      call: guardedChat,
      tools: [countingTool, ...(probes ? [probeTool(opts.task, probes, probesUsed)] : []), ...(ruler ? [rulerTool(opts.task, ruler, rulerUsed)] : [])],
      maxRounds: multi ? probes + ruler + 3 : 1,
      maxToolCalls: multi ? probes + ruler + 2 : 1,
      params: { model, messages: msgs, max_tokens: 3500, temperature: opts.lens.temperature ?? 0.4, chat_template_kwargs: { enable_thinking: false } },
    }));

  const build = (via: Proposal["via"]): Proposal => {
    const a = sink.last?.args ?? {};
    return {
      designer: opts.lens.id,
      model,
      rationale: String(a.rationale ?? "").slice(0, 600),
      appliedLessons: Array.isArray(a.appliedLessons) ? a.appliedLessons.map(String).slice(0, 8) : [],
      prediction: typeof a.prediction === "object" && a.prediction ? a.prediction : {},
      layout: a.layout ?? null,
      errors: sink.last?.errors ?? [],
      via,
      toolReceipts: receipts,
      probes: probesUsed,
    };
  };

  let first;
  try {
    first = await turn(messages);
  } catch (e) {
    return { ...build("failed"), errors: [`model call failed: ${String((e as Error).message).slice(0, 160)}`] };
  }
  receipts.push(...first.receipts.map((r) => ({ id: r.id, name: r.name, status: r.status })));
  if (!first.receipts.length) {
    // The model answered in text instead of calling the tool: parse once, counted as a fallback.
    try {
      const args = parseJson<any>(first.content);
      sink.last = { args, errors: validateForTask(args.layout, opts.task) };
      return build(sink.last.errors.length ? "failed" : "text_fallback");
    } catch {
      return { ...build("failed"), errors: ["no tool call and no parseable layout in reply"] };
    }
  }
  if (sink.last && !sink.last.errors.length) return build(proposeCalls > 1 ? "tool_after_repair" : "tool");
  if (multi) return { ...build("failed"), errors: sink.last?.errors.length ? sink.last.errors : ["used test tools but never submitted with propose_layout"] };

  // One repair: same conversation, the tool's errors are already in the transcript.
  try {
    const second = await turn([...first.messages, { role: "user", content: "Fix every error listed in the tool result and call propose_layout again." }]);
    receipts.push(...second.receipts.map((r) => ({ id: r.id, name: r.name, status: r.status })));
  } catch (e) {
    return { ...build("failed"), errors: [...(sink.last?.errors ?? []), `repair call failed: ${String((e as Error).message).slice(0, 120)}`] };
  }
  return build(sink.last && !sink.last.errors.length ? "tool_after_repair" : "failed");
}
