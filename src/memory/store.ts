/**
 * Shared Brain: an append-only log of memory ops, reduced deterministically into the
 * Playbook every agent reads. Parallel writers only append, so there are no write
 * conflicts; the same log always reduces to the same Playbook.
 *
 * Knowledge is labeled by its basis:
 *  - untested:                  an external hypothesis from cited web research. Never a simulator rule.
 *  - isolated-test:             an external hypothesis whose own small intervention (1-3 edits on the
 *                               champion) was scored by the simulator and improved the validation days.
 *  - observed-from-experiment:  a lesson the reflector wrote from an accepted change's code receipts.
 * A model citing a lesson in a winning proposal is recorded as a citation only. A composite win is not
 * evidence that the cited hypothesis was implemented or caused the gain.
 */
import type { CitedLesson } from "../replay.ts";

export interface Source {
  url: string;
  title: string;
  excerpts: string[];
}

export interface Evidence {
  gen: number;
  candidateId: string;
  accepted: boolean;
  /** Select objective change vs the champion at that time (negative = better). */
  deltaSelect: number | null;
  /** Code-computed per-edit receipts for accepted candidates. */
  edits?: { edit: string; deltaAlone: number }[];
  /** True only for an isolated hypothesis test (its own bounded intervention vs the champion). */
  isolated?: boolean;
}

export type Basis = "untested" | "isolated-test" | "observed-from-experiment";

export type MemoryOp =
  | {
      op: "add_external";
      id: string;
      text: string;
      testableAs: string;
      sources: Source[];
      query: string;
      retrievedAt: string;
      toolReceiptId: string;
    }
  | { op: "add_verified"; id: string; text: string; scope: string; evidence: Evidence; author: string }
  /** A designer said its proposal relied on this lesson. Not evidence. */
  | { op: "cited"; id: string; evidence: Evidence }
  /** Isolated test of a hypothesis. `improved` is decided by code against the gate margin. */
  | { op: "tested"; id: string; evidence: Evidence; improved: boolean }
  | { op: "retire"; id: string; reason: string };

export interface Lesson {
  id: string;
  kind: "external" | "verified";
  /** external hypotheses that earned evidence keep kind "external" origin but status "verified". */
  status: "hypothesis" | "verified" | "retired";
  text: string;
  testableAs?: string;
  scope?: string;
  sources: Source[];
  query?: string;
  retrievedAt?: string;
  toolReceiptId?: string;
  basis: Basis;
  /** Isolated tests run / tests that improved validation days. Only these move confidence. */
  helped: number;
  trials: number;
  /** Citations by designers (not evidence). */
  cited: number;
  citedInAccepted: number;
  evidence: Evidence[];
  retiredReason?: string;
}

export interface MemoryState {
  version: number;
  lessons: Lesson[];
}

export const MAX_ACTIVE = 8;

/** Beta(1,1) prior: mean of "improved when tested in isolation". */
export const posteriorMean = (l: Pick<Lesson, "helped" | "trials">) => (l.helped + 1) / (l.trials + 2);

export function reduce(ops: MemoryOp[]): MemoryState {
  const lessons = new Map<string, Lesson>();
  for (const o of ops) {
    if (o.op === "add_external") {
      if (lessons.has(o.id)) continue;
      lessons.set(o.id, {
        id: o.id, kind: "external", status: "hypothesis", text: o.text, testableAs: o.testableAs,
        sources: o.sources, query: o.query, retrievedAt: o.retrievedAt, toolReceiptId: o.toolReceiptId,
        basis: "untested", helped: 0, trials: 0, cited: 0, citedInAccepted: 0, evidence: [],
      });
    } else if (o.op === "add_verified") {
      if (lessons.has(o.id)) continue;
      lessons.set(o.id, {
        id: o.id, kind: "verified", status: "verified", text: o.text, scope: o.scope, sources: [],
        basis: "observed-from-experiment", helped: 0, trials: 0, cited: 0, citedInAccepted: 0, evidence: [o.evidence],
      });
    } else {
      const l = lessons.get(o.id);
      if (!l || l.status === "retired") continue;
      if (o.op === "cited") {
        l.cited += 1;
        if (o.evidence.accepted) l.citedInAccepted += 1;
      } else if (o.op === "tested") {
        if (!o.evidence.isolated) continue; // only isolated interventions count as tests
        l.trials += 1;
        if (o.improved) l.helped += 1;
        l.evidence.push(o.evidence);
        if (o.improved && l.status === "hypothesis") {
          l.status = "verified";
          l.basis = "isolated-test";
        }
      } else if (o.op === "retire") {
        l.status = "retired";
        l.retiredReason = o.reason;
      }
    }
  }
  // Keep the active set lean: beyond the cap, the lowest-posterior lessons are hidden from prompts.
  return { version: ops.length, lessons: [...lessons.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

export function active(state: MemoryState): Lesson[] {
  return state.lessons
    .filter((l) => l.status !== "retired")
    .sort((a, b) => posteriorMean(b) - posteriorMean(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_ACTIVE)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Byte-stable rendering for prompts: identical state -> identical text, so the
 * Playbook works as a cacheable shared prefix across agents.
 */
export function render(state: MemoryState): string {
  const ls = active(state);
  if (!ls.length) return "SHARED PLAYBOOK (version 0): empty. Nothing has been learned yet.";
  const lines = ls.map((l) => {
    const test = l.evidence.find((e) => e.isolated);
    const tag =
      l.basis === "isolated-test"
        ? `INTERVENTION IMPROVED in an isolated test (validation objective ${test?.deltaSelect}; tested edits: ${(test?.edits ?? []).map((e) => e.edit).join("; ")}). This supports those edits, not every claim in the source`
        : l.basis === "observed-from-experiment"
          ? "OBSERVED in an accepted experiment (code-computed receipts)"
          : l.trials
            ? `EXTERNAL hypothesis, isolated test showed no improvement (validation objective ${test?.deltaSelect ?? "n/a"})`
            : "EXTERNAL hypothesis (untested in our simulator)";
    const receipts = l.basis === "observed-from-experiment" && l.evidence[0]?.edits?.length
      ? ` Receipts: ${l.evidence[0].edits.map((e) => `${e.edit} ${e.deltaAlone > 0 ? "+" : ""}${e.deltaAlone}`).join("; ")}.`
      : "";
    const stats = `${l.trials ? `tested ${l.trials}x, improved ${l.helped}x; ` : ""}cited ${l.cited}x`;
    const src = l.sources.length ? ` Sources: ${l.sources.map((s) => s.url).join(" ")}` : "";
    return `- [${l.id}] ${tag}; ${stats}. ${l.text}${l.testableAs ? ` Test: ${l.testableAs}` : ""}${receipts}${src}`;
  });
  return `SHARED PLAYBOOK (version ${state.version}). External items are cited evidence from the web, not rules; only simulator results count.\n${lines.join("\n")}`;
}

/** Retire hypotheses whose isolated tests never improved validation (keeps memory lean). */
export function retirements(state: MemoryState): MemoryOp[] {
  return state.lessons
    .filter((l) => l.status === "hypothesis" && l.trials >= 1 && l.helped === 0)
    .map((l) => ({ op: "retire" as const, id: l.id, reason: `isolated test showed no improvement (${l.trials} test${l.trials > 1 ? "s" : ""})` }));
}

export function toCited(state: MemoryState): CitedLesson[] {
  return state.lessons.map((l) => ({
    id: l.id,
    kind: l.status === "verified" ? "verified" : "external",
    basis: l.basis,
    status: l.status,
    cited: l.cited,
    citedInAccepted: l.citedInAccepted,
    test: l.evidence.find((e) => e.isolated) ? { deltaSelect: l.evidence.find((e) => e.isolated)!.deltaSelect, edits: l.evidence.find((e) => e.isolated)!.edits ?? [] } : undefined,
    receipts: l.basis === "observed-from-experiment" ? l.evidence[0]?.edits ?? [] : undefined,
    text: l.text,
    sources: l.sources.map((s) => ({ url: s.url, title: s.title })),
    posterior: { helped: l.helped, trials: l.trials, mean: Math.round(posteriorMean(l) * 100) / 100 },
  }));
}
