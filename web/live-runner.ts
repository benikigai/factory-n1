/**
 * Dev-server-only "Run live" endpoints. Imported by vite.config.ts configureServer and never by client code,
 * so nothing here reaches the static build (scripts/build-static.ts fails the build if it does).
 *
 *   GET  /api/run/status  -> { available, configured, running, runId, presets, last }
 *   POST /api/run         -> body {"preset":"fresh"|"continue"} -> spawns scripts/solve.ts, returns { runId }
 *   POST /api/run/stop    -> sends SIGINT to the running solve
 *
 * Locked down: loopback peers only, a loopback Host and Origin (blocks cross-site and DNS-rebinding requests),
 * one run at a time, explicit spend caps on every run. The Crusoe/You.com keys are read by the child process
 * from FACTORY_ENV_FILE via node --env-file; this module never reads, logs or returns them or the path.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  const used = existsSync(runsDir) ? readdirSync(runsDir).map((f) => /^live-demo-(\d+)(\.log)?$/.exec(f)?.[1]).filter(Boolean).map(Number) : [];
  return `live-demo-${(used.length ? Math.max(...used) : 0) + 1}`;
}

let child: ChildProcess | null = null;
let current: { runId: string; preset: string; startedAt: number } | null = null;
let last: { runId: string; exitCode: number | null; signal: string | null; message: string } | null = null;

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
        running: Boolean(current),
        runId: current?.runId ?? null,
        preset: current?.preset ?? null,
        caps: liveCaps(),
        presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.label])),
        last,
      });
    }

    if (pathname === "/api/run/stop" && method === "POST") {
      if (!child || !current) return send(res, 409, { error: "No live run is running." });
      child.kill("SIGINT");
      return send(res, 202, { stopping: current.runId });
    }

    if (pathname === "/api/run" && method === "POST") {
      if (current) return send(res, 409, { error: `${current.runId} is already running. One live run at a time.`, runId: current.runId });
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
      const logFile = path.join(runsDir, `${runId}.log`);
      const log = openSync(logFile, "a");
      const proc = spawn(
        process.execPath,
        [`--env-file=${process.env.FACTORY_ENV_FILE}`, "--import", "tsx", "scripts/solve.ts", String(preset.generations), runId, String(preset.probes)],
        {
          cwd: repoRoot,
          env: { ...process.env, ...preset.env, CALL_BUDGET: String(caps.calls), SPEND_CAP_USD: String(caps.usd) },
          stdio: ["ignore", log, log],
        },
      );
      closeSync(log);
      child = proc;
      current = { runId, preset: presetId, startedAt: Date.now() };
      proc.on("exit", (code, signal) => {
        last = { runId, exitCode: code, signal, message: code === 0 ? "finished" : lastLine(logFile) || `exited with ${signal ?? code}` };
        child = null;
        current = null;
      });
      return send(res, 202, { runId, preset: presetId, caps });
    }
    return send(res, 404, { error: "Unknown endpoint." });
  };
}
