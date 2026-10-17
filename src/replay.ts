/**
 * The bundle the 3D viewer plays: baseline and agent-improved factory run on the
 * SAME scenario, with the evidence behind the change. Written by the solve loop to
 * runs/<runId>/replay.json. Owner: Claude. The viewer only reads it.
 */
import type { Layout, RunMetrics, RunResult } from "./sim/types.ts";

export interface SplitScore {
  objective: number;
  dodPassed: boolean;
}

export interface ReplaySide {
  label: string;
  layout: Layout;
  /** Full trace of this layout on the shared replay scenario. */
  result: RunResult;
  train: SplitScore;
  select: SplitScore;
  /** Locked final split (fresh demand seeds), scored once after the run. Absent for development runs. */
  final?: SplitScore & { zeroDamage: boolean; allShipped: boolean; damagedTotal: number; scenarios: number };
}

export interface EditReceipt {
  /** Human-readable atomic edit, e.g. "pack-1 sizes S,M -> S,M,L" or "sort-1 (20,2) -> (10,7)". */
  edit: string;
  /** Code-computed objective change on train when this edit alone is applied to the previous champion. */
  deltaAlone: number;
}

export interface CitedLesson {
  id: string;
  /** verified = promoted by an isolated test or observed from an accepted experiment; external = still a hypothesis. */
  kind: "external" | "verified";
  basis?: "untested" | "isolated-test" | "observed-from-experiment" | "observed-from-rejected-experiment";
  status?: "hypothesis" | "verified" | "retired";
  /** Times designers cited it, and how many of those proposals won (citations are not evidence). */
  cited?: number;
  citedInAccepted?: number;
  /** Isolated test result for external hypotheses. */
  test?: { deltaSelect: number | null; edits: { edit: string; deltaAlone: number }[] };
  /** Code receipts behind an observed lesson. */
  receipts?: { edit: string; deltaAlone: number }[];
  text: string;
  sources: { url: string; title: string }[];
  /** Beta posterior of "helped when applied", from code-measured outcomes. */
  posterior: { helped: number; trials: number; mean: number };
}

export interface AcceptedChange {
  gen: number;
  candidateId: string;
  designer: string;
  rationale: string;
  selectBefore: number;
  selectAfter: number;
  edits: EditReceipt[];
  /** Lessons the designer declared it applied. */
  appliedLessons: string[];
  prediction?: Partial<Pick<RunMetrics, "objective" | "missorts" | "damaged" | "makespan">>;
  claimRefuted?: boolean;
}

export interface RejectedCandidate {
  gen: number;
  candidateId: string;
  designer: string;
  rationale: string;
  reason: string;
  /** Train objective if it was valid; null when the layout failed validation. */
  trainObjective: number | null;
  errors: string[];
  layout: Layout | null;
  /** Atomic edits vs the champion at the time (empty when invalid). */
  edits?: string[];
}

export interface ReplayBundle {
  runId: string;
  /** synthetic = fixture with no model calls; recorded = real run replayed; live = run in progress. */
  mode: "synthetic" | "recorded" | "live";
  createdAt: string;
  simVersion: string;
  graderHash: string;
  task: { id: string; goal: string };
  scenario: { id: string; seed: number; profile: string };
  baseline: ReplaySide;
  improved: ReplaySide;
  /** Comparator rows computed by code, so the agent result is never shown alone. */
  comparators: { label: string; train: number; select: number }[];
  accepted: AcceptedChange[];
  rejected: RejectedCandidate[];
  lessons: CitedLesson[];
  curve: { gen: number; championSelect: number; candidates: { id: string; train: number | null; accepted: boolean }[] }[];
  usage: { calls: number; usd: number; searches: number; searchUsd: number };
}
