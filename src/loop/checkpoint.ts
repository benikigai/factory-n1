import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CallGuardState } from "../agents/call-guard.ts";
import type { SpendState } from "../llm/crusoe.ts";
import { createYouSearch } from "../llm/you-search.ts";
import type { MemoryOp } from "../memory/store.ts";
import type { AcceptedChange, RejectedCandidate, ReplayBundle } from "../replay.ts";
import type { Evaluation } from "../sim/evaluate.ts";
import type { Layout } from "../sim/types.ts";
import type { Counts, MeterState } from "./meter.ts";

export interface CheckpointManifest {
  task: unknown;
  options: unknown;
  gitCommit: string;
  graderHash: string;
}

export interface LoopCheckpointState {
  initialized: boolean;
  generation: number;
  champion: Layout;
  champId: string;
  champTrain: Evaluation;
  champSelect: Evaluation;
  baselineTrain: Evaluation;
  baselineSelect: Evaluation;
  ops: MemoryOp[];
  accepted: AcceptedChange[];
  rejected: RejectedCandidate[];
  curve: ReplayBundle["curve"];
  seen: string[];
  stalled: number;
  simEvals: number;
  researchLog: object[];
  stopReason: string;
  finished: boolean;
  elapsedMs: number;
  meter0: Counts;
  calls0: number;
  usd0: number;
  runtime: { meter: MeterState; calls: CallGuardState; spend: SpendState; searches: number };
}

type Runtime = LoopCheckpointState["runtime"];

/** Keep uncommitted attempts charged even when their generation needs to be replayed. */
export function saveRuntimeCheckpoint(dir: string, hash: string, runtime: Runtime) {
  writeAtomicJson(join(dir, "runtime.json"), { manifestHash: hash, runtime });
}

export function readRuntimeCheckpoint(dir: string, hash: string): Runtime | null {
  const path = join(dir, "runtime.json");
  if (!existsSync(path)) return null;
  const saved = JSON.parse(readFileSync(path, "utf8"));
  if (saved.manifestHash !== hash || !saved.runtime) throw new Error("runtime checkpoint manifest mismatch");
  return saved.runtime;
}

interface Journal { bytes: number; sha256: string }
export interface Checkpoint<S, R = unknown> {
  version: 1;
  manifestHash: string;
  state: S;
  journals: Record<string, Journal>;
  result?: R;
}

const JOURNALS = ["events.jsonl", "experiments.jsonl"];
const RUN_ARTIFACTS = [...JOURNALS, "summary.json", "checkpoint.json", "replay.json", "champion.json", "memory.json", "research.json", "runtime.json", "pairs.jsonl", "results.json", "frozen-playbook.json", "spend.json", "INCOMPLETE.json"];
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Object key order is not part of a run's identity. Array order is. */
export function manifestHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
    return v;
  };
  return digest(JSON.stringify(canonical(value)));
}

export function currentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The rename is the commit point. fsync the file and containing directory before returning. */
export function writeAtomicJson(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
    const directory = openSync(join(path, ".."), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

/** Persist identity before the first call, so a restart cannot silently reuse a run ID. */
export function bindManifest(dir: string, manifest: CheckpointManifest): string {
  mkdirSync(dir, { recursive: true });
  const hash = manifestHash(manifest);
  const path = join(dir, "manifest.json");
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    if (saved.version !== 1 || saved.hash !== hash || manifestHash(saved.manifest) !== hash) throw new Error("checkpoint manifest mismatch: task, options, git commit or grader changed; use a new runId");
  } else {
    if (RUN_ARTIFACTS.some((file) => existsSync(join(dir, file)))) throw new Error("existing run has no checkpoint manifest; use a new runId");
    writeAtomicJson(path, { version: 1, hash, manifest });
  }
  return hash;
}

export function readCheckpoint<S, R = unknown>(dir: string, hash: string): Checkpoint<S, R> | null {
  const path = join(dir, "checkpoint.json");
  if (!existsSync(path)) {
    if (JOURNALS.some((file) => existsSync(join(dir, file)) && statSync(join(dir, file)).size)) throw new Error("run interrupted before its initial checkpoint; use a new runId");
    return null;
  }
  const saved = JSON.parse(readFileSync(path, "utf8")) as Checkpoint<S, R>;
  if (saved.version !== 1 || saved.manifestHash !== hash || !saved.state || !saved.journals) throw new Error("invalid or mismatched checkpoint");
  // Validate every journal before changing any file. Only a suffix written after the commit is discarded.
  for (const file of JOURNALS) {
    const journal = saved.journals[file];
    const bytes = existsSync(join(dir, file)) ? readFileSync(join(dir, file)) : Buffer.alloc(0);
    if (!journal || !Number.isSafeInteger(journal.bytes) || journal.bytes < 0 || bytes.length < journal.bytes || digest(bytes.subarray(0, journal.bytes)) !== journal.sha256) throw new Error(`checkpoint journal changed: ${file}`);
  }
  for (const file of JOURNALS) if (existsSync(join(dir, file))) truncateSync(join(dir, file), saved.journals[file].bytes);
  return saved;
}

export function saveCheckpoint<S, R = unknown>(dir: string, hash: string, state: S, result?: R) {
  const journals = Object.fromEntries(JOURNALS.map((file) => {
    const path = join(dir, file);
    const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
    if (existsSync(path)) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
    return [file, { bytes: bytes.length, sha256: digest(bytes) }];
  }));
  writeAtomicJson(join(dir, "checkpoint.json"), { version: 1, manifestHash: hash, state, journals, ...(result === undefined ? {} : { result }) });
}

/** Restore the search allowance without charging a fresh allowance on each restart. */
export function resumedSearch(maxCalls: number, previousAttempts = 0, onAttempt?: () => void): ReturnType<typeof createYouSearch> {
  if (!Number.isInteger(previousAttempts) || previousAttempts < 0 || previousAttempts > maxCalls) throw new Error("invalid checkpoint search count");
  const search = createYouSearch({ maxCalls: maxCalls - previousAttempts, fetch: (...args) => { onAttempt?.(); return fetch(...args); } });
  return { ...search, usage: () => ({ attempts: previousAttempts + search.usage().attempts, estimatedUsd: (previousAttempts + search.usage().attempts) * 0.005 }) };
}

/** Read completed evaluation pairs; an interrupted final line is safe to retry. */
export function readCompletedPairs<T extends { factory: string; rep: number }>(path: string): T[] {
  if (!existsSync(path)) return [];
  const body = readFileSync(path, "utf8");
  const end = body.lastIndexOf("\n") + 1;
  const rows = body.slice(0, end).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.factory}:${row.rep}`;
    if (seen.has(key)) throw new Error(`duplicate persisted evaluation pair: ${key}`);
    seen.add(key);
  }
  if (end < body.length) truncateSync(path, Buffer.byteLength(body.slice(0, end)));
  return rows;
}
