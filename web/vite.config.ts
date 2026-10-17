import { createReadStream, realpathSync, statSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "..");
/** Local runs first, then committed public recordings (recorded/), so a fresh clone still plays the hero run. */
const runRoots = [path.join(repoRoot, "runs"), path.join(repoRoot, "recorded")];

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function fail(res: ServerResponse, code: number, msg: string) {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(msg);
}

/** Read-only GET /runs/** -> <repo>/runs/** or <repo>/recorded/**. Rejects traversal, dotfiles, and symlinks escaping those dirs. */
function serveRuns(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
  const raw = req.url ?? "";
  const pathname = raw.split("?")[0];
  if (!pathname.startsWith("/runs/")) return next();
  if (pathname === "/runs/index.json") {
    const recorded = path.join(repoRoot, "recorded");
    const runs = readdirSync(recorded).filter(id => existsSync(path.join(recorded, id, "replay.json")));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ runs, default: "live-a-11", artifacts: Object.fromEntries(runs.map(id => [id, readdirSync(path.join(recorded, id)).filter(name => /\.(json|jsonl)$/.test(name))])) }));
    return;
  }
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
  let real = "";
  for (const root of runRoots) {
    const file = path.resolve(root, ...parts);
    if (!file.startsWith(root + path.sep)) return fail(res, 403, "forbidden");
    try {
      const r = realpathSync(file);
      if (r.startsWith(realpathSync(root) + path.sep) && statSync(r).isFile()) {
        real = r;
        break;
      }
    } catch {
      // not in this root; try the next one
    }
  }
  if (!real) return fail(res, 404, "not found");
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(real).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") return res.end();
  createReadStream(real).on("error", () => fail(res, 500, "read error")).pipe(res);
}

/** Read-only GET /evidence/<file> -> <repo>/docs/evidence/<file> (dev only; the static build copies them). */
const evidenceDir = path.join(repoRoot, "docs", "evidence");
function serveEvidence(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
  const pathname = (req.url ?? "").split("?")[0];
  if (!pathname.startsWith("/evidence/")) return next();
  const name = decodeURIComponent(pathname.slice("/evidence/".length));
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) return fail(res, 400, "bad path");
  if (name === "index.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ files: [...readdirSync(evidenceDir).filter(file => /\.(json|md)$/.test(file)), "spec-as-built.md"] }));
    return;
  }
  const file = name === "spec-as-built.md" ? path.join(repoRoot, "docs", "specs", "factory-n1.md") : path.join(evidenceDir, name);
  try {
    if (!statSync(file).isFile()) return fail(res, 404, "not found");
  } catch {
    return fail(res, 404, "not found");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] ?? "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  createReadStream(file).pipe(res);
}

function runsPlugin(): Plugin {
  return {
    name: "factory-n1-runs",
    configureServer(server) {
      server.middlewares.use(serveRuns);
      server.middlewares.use(serveEvidence);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveRuns);
    },
  };
}

export default defineConfig({
  base: "./",
  root: webDir,
  plugins: [runsPlugin()],
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: [repoRoot] },
  },
  preview: { port: 4173, strictPort: false },
  build: {
    rollupOptions: {
      input: { index: path.join(webDir, "index.html"), replay: path.join(webDir, "replay.html") },
    },
    outDir: path.join(webDir, "dist"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
