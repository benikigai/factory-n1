import { createReadStream, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "..");
const runsDir = path.join(repoRoot, "runs");

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

function fail(res: ServerResponse, code: number, msg: string) {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(msg);
}

/** Read-only GET /runs/** -> <repo>/runs/**. Rejects traversal, dotfiles, and symlinks escaping runs/. */
function serveRuns(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
  const raw = req.url ?? "";
  const pathname = raw.split("?")[0];
  if (!pathname.startsWith("/runs/")) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "read-only");
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice("/runs/".length));
  } catch {
    return fail(res, 400, "bad path");
  }
  const parts = rel.split(/[\\/]/);
  if (!rel || rel.includes("\0") || path.isAbsolute(rel) || parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) {
    return fail(res, 400, "bad path");
  }
  const file = path.resolve(runsDir, ...parts);
  if (!file.startsWith(runsDir + path.sep)) return fail(res, 403, "forbidden");
  let real: string;
  try {
    real = realpathSync(file);
    if (!real.startsWith(realpathSync(runsDir) + path.sep) || !statSync(real).isFile()) return fail(res, 404, "not found");
  } catch {
    return fail(res, 404, "not found");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(real).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") return res.end();
  createReadStream(real).on("error", () => fail(res, 500, "read error")).pipe(res);
}

function runsPlugin(): Plugin {
  return {
    name: "factory-n1-runs",
    configureServer(server) {
      server.middlewares.use(serveRuns);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveRuns);
    },
  };
}

export default defineConfig({
  root: webDir,
  plugins: [runsPlugin()],
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: [repoRoot] },
  },
  preview: { port: 4173, strictPort: false },
  build: {
    outDir: path.join(webDir, "dist"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
