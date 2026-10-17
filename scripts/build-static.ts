// Static site for hosting: the built viewer plus the committed recorded runs it replays.
// No server code, no functions, no environment variables, no keys.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";

execFileSync("npx", ["vite", "build", "--config", "web/vite.config.ts"], { stdio: "inherit" });
const dirs = existsSync("recorded") ? readdirSync("recorded").filter((d) => !d.startsWith(".")) : [];
// Copy every recorded folder (replay bundles and the memory-evaluation results the landing page reads);
// only folders with a replay bundle are listed as replayable runs.
for (const id of dirs) cpSync(`recorded/${id}`, `web/dist/runs/${id}`, { recursive: true });
const runs = dirs.filter((d) => existsSync(`recorded/${d}/replay.json`));
mkdirSync("web/dist/runs", { recursive: true });
writeFileSync("web/dist/runs/index.json", JSON.stringify({ runs, default: "live-a-7", artifacts: Object.fromEntries(runs.map(id => [id, readdirSync(`recorded/${id}`).filter(name => /\.(json|jsonl)$/.test(name))])) }, null, 2));
// Public evidence files the landing page links to.
mkdirSync("web/dist/evidence", { recursive: true });
for (const f of readdirSync("docs/evidence").filter(name => /\.(md|json)$/.test(name))) {
  cpSync(`docs/evidence/${f}`, `web/dist/evidence/${f}`);
}
if (existsSync("docs/specs/factory-n1.md")) cpSync("docs/specs/factory-n1.md", "web/dist/evidence/spec-as-built.md");
writeFileSync("web/dist/evidence/index.json", JSON.stringify({ files: readdirSync("web/dist/evidence").filter(name => name !== "index.json") }, null, 2));
console.log(`static site in web/dist with runs: ${runs.join(", ")}`);
