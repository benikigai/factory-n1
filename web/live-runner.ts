/**
 * Dev-server-only "Run live" endpoints. Imported by vite.config.ts configureServer and never by client code,
 * so nothing here reaches the static build (scripts/build-static.ts fails the build if it does).
 *
 *   GET  /api/run/status  -> { available, configured, running, runId, presets, last }
 *   POST /api/run         -> body {"preset":"fresh"|"continue"} -> spawns scripts/solve.ts, returns { runId }
 *   POST /api/run/stop    -> sends SIGINT to the running solve
 *   POST /api/run/resume  -> body {"runId"} -> re-spawns solve with the same runId, preset and caps; the solver's
 *                            checkpoint resumes at the next generation and refuses if its manifest no longer matches
 *
 * Locked down: loopback peers only, a loopback Host and Origin (blocks cross-site and DNS-rebinding requests),
 * one run at a time, explicit spend caps on every run. The Crusoe/You.com keys are read by the child process
 * from FACTORY_ENV_FILE via node --env-file; this module never reads, logs or returns them or the path.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

type Preset = { label: string; generations: number; probes: number; env: Record<string, string>; needsRun?: string };
export const PRESETS: Record<string, Preset> = {
  fresh: { label: "Fresh from Gen 0", generations: 3, probes: 3, env: { RULER: "4" } },
  continue: {
    label: "Continue from run 7",
    generations: 3,
    probes: 3,
    env: { START_FROM_RUN: "live-a-7", LENSES: "route,quality,flow", RULER: "4", NO_RESEARCH: "1", SEQUENTIAL_DESIGNERS: "1" },
    needsRun: "live-a-7",
  },
};

/** Caps applied to every live run. Overridable by the person running the dev server, never above the ceilings. */
const CEILING = { calls: 200, usd: 0.3 };
export function liveCaps(env: NodeJS.ProcessEnv = process.env) {
  const calls = Math.min(CEILING.calls, Math.max(1, Math.floor(Number(env.FACTORY_LIVE_CALLS ?? 70) || 70)));
  const usd = Math.min(CEILING.usd, Math.max(0.01, Number(env.FACTORY_LIVE_USD ?? 0.1) || 0.1));
  return { calls, usd };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** True only for a request from this machine, addressed to a loopback host, and not from another site. */
export function isLocalRequest(req: Pick<IncomingMessage, "socket" | "headers">, method: string): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return false;
  if (!LOOPBACK_HOST.test(String(req.headers.host ?? ""))) return false;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  if (method !== "GET") {
    const origin = String(req.headers.origin ?? "");
    try {
      if (!LOOPBACK_HOST.test(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function nextRunId(runsDir: string): string {
  const used = existsSync(runsDir) ? readdirSync(runsDir).map((f) => /^live-demo-(\d+)(\..+)?$/.exec(f)?.[1]).filter(Boolean).map(Number) : [];
  return `live-demo-${(used.length ? Math.max(...used) : 0) + 1}`;
}

/** Per-run launch record, kept beside (not inside) the run directory so the solver's checkpoint never sees it. */
export type LiveRecord = { preset: string; caps: { calls: number; usd: number }; startedAt: string; resumes: { at: string; fromGeneration: number }[] };
const recordPath = (runsDir: string, runId: string) => path.join(runsDir, `${runId}.live.json`);
const checkpointCache = new Map<string, { mtimeMs: number; generation: number; finished: boolean }>();

/** Whether runId can be resumed: started here, stopped before finishing, with a checkpoint. */
export function resumeInfo(runsDir: string, runId: string):
  | { ok: true; record: LiveRecord; fromGeneration: number }
  | { ok: false; error: string } {
  if (!/^live-demo-\d+$/.test(runId)) return { ok: false, error: "Only live-demo runs started here can be resumed." };
  const dir = path.join(runsDir, runId);
  if (existsSync(path.join(dir, "summary.json"))) return { ok: false, error: `${runId} already finished.` };
  let record: LiveRecord;
  try {
    record = JSON.parse(readFileSync(recordPath(runsDir, runId), "utf8")) as LiveRecord;
  } catch {
    return { ok: false, error: `${runId} has no launch record, so its options are unknown.` };
  }
  if (!PRESETS[record.preset]) return { ok: false, error: `${runId} used an unknown preset.` };
  const file = path.join(dir, "checkpoint.json");
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { ok: false, error: `${runId} stopped before its first checkpoint.` };
  }
  let cp = checkpointCache.get(file);
  if (!cp || cp.mtimeMs !== mtimeMs) {
    try {
      const st = (JSON.parse(readFileSync(file, "utf8")) as { state?: { generation?: number; finished?: boolean } }).state ?? {};
      cp = { mtimeMs, generation: Number(st.generation ?? 0), finished: Boolean(st.finished) };
      checkpointCache.set(file, cp);
    } catch {
      return { ok: false, error: `${runId} has an unreadable checkpoint.` };
    }
  }
  if (cp.finished) return { ok: false, error: `${runId} already finished.` };
  return { ok: true, record, fromGeneration: cp.generation };
}

/** The newest live-demo run that stopped early and can be resumed, if any. */
export function latestResumable(runsDir: string) {
  if (!existsSync(runsDir)) return null;
  const ids = readdirSync(runsDir).filter((f) => /^live-demo-\d+$/.test(f)).sort((a, b) => Number(b.split("-")[2]) - Number(a.split("-")[2]));
  for (const id of ids) {
    if (existsSync(path.join(runsDir, id, "summary.json"))) return null; // newest unfinished only
    const r = resumeInfo(runsDir, id);
    return r.ok ? { runId: id, fromGeneration: r.fromGeneration } : null;
  }
  return null;
}

// Kept on globalThis so a Vite config reload (which re-imports this module in the same process) does not
// forget a running child: otherwise status would say idle, a second run could start, and Stop would not work.
type LiveState = {
  child: ChildProcess | null;
  current: { runId: string; preset: string; startedAt: number } | null;
  last: { runId: string; exitCode: number | null; signal: string | null; message: string } | null;
};
const state: LiveState = ((globalThis as { __factoryLive?: LiveState }).__factoryLive ??= { child: null, current: null, last: null });

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Last non-empty log line, for a failed start (e.g. "CRUSOE_API_KEY is not set"). solve.ts never prints keys. */
function lastLine(logFile: string): string {
  try {
    if (statSync(logFile).size > 2_000_000) return "";
    const lines = readFileSync(logFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const err = lines.find((l) => l.startsWith("Error:"));
    return (err ?? lines.at(-1) ?? "").slice(0, 200);
  } catch {
    return "";
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024) break;
  }
  return body;
}

export function liveRunner(repoRoot: string) {
  const runsDir = path.join(repoRoot, "runs");
  /** Spawn the solver for runId with the recorded preset and caps. Output appends to runs/<runId>.log. */
  const start = (runId: string, record: LiveRecord) => {
    const preset = PRESETS[record.preset];
    const logFile = path.join(runsDir, `${runId}.log`);
    const log = openSync(logFile, "a");
    const proc = spawn(
      process.execPath,
      [`--env-file=${process.env.FACTORY_ENV_FILE}`, "--import", "tsx", "scripts/solve.ts", String(preset.generations), runId, String(preset.probes)],
      {
        cwd: repoRoot,
        env: { ...process.env, ...preset.env, CALL_BUDGET: String(record.caps.calls), SPEND_CAP_USD: String(record.caps.usd) },
        stdio: ["ignore", log, log],
      },
    );
    closeSync(log);
    state.child = proc;
    state.current = { runId, preset: record.preset, startedAt: Date.now() };
    proc.on("exit", (code, signal) => {
      state.last = { runId, exitCode: code, signal, message: code === 0 ? "finished" : lastLine(logFile) || `exited with ${signal ?? code}` };
      state.child = null;
      state.current = null;
    });
  };
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (!pathname.startsWith("/api/run")) return next();
    const method = req.method ?? "GET";
    if (!isLocalRequest(req, method)) return send(res, 403, { error: "Run live is available only from this machine." });
    const configured = Boolean(process.env.FACTORY_ENV_FILE && existsSync(process.env.FACTORY_ENV_FILE));

    if (pathname === "/api/run/status" && method === "GET") {
      return send(res, 200, {
        available: true,
        configured,
        running: Boolean(state.current),
        runId: state.current?.runId ?? null,
        preset: state.current?.preset ?? null,
        caps: liveCaps(),
        resumable: state.current ? null : latestResumable(runsDir),
        presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.label])),
        last: state.last,
      });
    }

    if (pathname === "/api/run/stop" && method === "POST") {
      if (!state.child || !state.current) return send(res, 409, { error: "No live run is running." });
      state.child.kill("SIGINT");
      return send(res, 202, { stopping: state.current.runId });
    }

    if (pathname === "/api/run" && method === "POST") {
      if (state.current) return send(res, 409, { error: `${state.current.runId} is already running. One live run at a time.`, runId: state.current.runId });
      if (!configured) return send(res, 412, { error: "Set FACTORY_ENV_FILE to the 1Password env mount before starting the dev server." });
      let presetId = "";
      try {
        presetId = String(JSON.parse((await readBody(req)) || "{}").preset ?? "");
      } catch {
        return send(res, 400, { error: "Body must be JSON." });
      }
      const preset = PRESETS[presetId];
      if (!preset) return send(res, 400, { error: `Unknown preset. Use one of: ${Object.keys(PRESETS).join(", ")}.` });
      if (preset.needsRun && !existsSync(path.join(runsDir, preset.needsRun, "champion.json"))) {
        return send(res, 412, { error: `runs/${preset.needsRun} is missing on this machine.` });
      }
      mkdirSync(runsDir, { recursive: true });
      const runId = nextRunId(runsDir);
      const caps = liveCaps();
      const record: LiveRecord = { preset: presetId, caps, startedAt: new Date().toISOString(), resumes: [] };
      writeFileSync(recordPath(runsDir, runId), JSON.stringify(record, null, 2));
      start(runId, record);
      return send(res, 202, { runId, preset: presetId, caps });
    }

    if (pathname === "/api/run/resume" && method === "POST") {
      if (state.current) return send(res, 409, { error: `${state.current.runId} is already running. One live run at a time.` });
      if (!configured) return send(res, 412, { error: "Set FACTORY_ENV_FILE to the 1Password env mount before starting the dev server." });
      let runId = "";
      try {
        runId = String(JSON.parse((await readBody(req)) || "{}").runId ?? "");
      } catch {
        return send(res, 400, { error: "Body must be JSON." });
      }
      const info = resumeInfo(runsDir, runId);
      if (!info.ok) return send(res, 409, { error: info.error });
      const record = { ...info.record, resumes: [...info.record.resumes, { at: new Date().toISOString(), fromGeneration: info.fromGeneration }] };
      writeFileSync(recordPath(runsDir, runId), JSON.stringify(record, null, 2));
      start(runId, record); // same runId, preset and caps; the solver checks its manifest and refuses on any mismatch
      return send(res, 202, { runId, resumedFromGeneration: info.fromGeneration });
    }
    return send(res, 404, { error: "Unknown endpoint." });
  };
}
