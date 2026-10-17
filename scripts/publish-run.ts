// Copy a run into recorded/<runId>/ for the public repo and static site.
// Third-party web excerpts (You.com snippets) are stripped; URLs, titles, queries,
// retrieval times and tool receipt ids are kept so every citation stays traceable.
// The full local run in runs/<runId>/ is left untouched.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const runId = process.argv[2];
if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("usage: tsx scripts/publish-run.ts <runId>");
const src = `runs/${runId}`;
const dst = `recorded/${runId}`;
if (!existsSync(`${src}/replay.json`)) throw new Error(`${src}/replay.json not found`);
mkdirSync(dst, { recursive: true });

const strip = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(strip) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => (k === "excerpts" ? [k, []] : [k, strip(x)])))
    : v;

for (const f of ["replay.json", "summary.json", "champion.json", "events.jsonl", "experiments.jsonl"]) {
  if (existsSync(`${src}/${f}`)) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
}
for (const f of ["memory.json", "research.json"]) {
  if (!existsSync(`${src}/${f}`)) continue;
  const data = strip(JSON.parse(readFileSync(`${src}/${f}`, "utf8")));
  writeFileSync(`${dst}/${f}`, JSON.stringify({ note: "Public copy: third-party search excerpts removed; URLs, titles, queries, retrieval times and receipt ids kept.", data }, null, 2));
}
const leaked = ["memory.json", "research.json"].some((f) => existsSync(`${dst}/${f}`) && /"excerpts":\s*\[\s*"/.test(readFileSync(`${dst}/${f}`, "utf8")));
if (leaked) throw new Error("excerpt text survived stripping");
console.log(`published ${src} -> ${dst}`);
