// Static site for hosting: the built viewer plus the committed recorded runs it replays.
// No server code, no functions, no environment variables, no keys.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";

execFileSync("npx", ["vite", "build", "--config", "web/vite.config.ts"], { stdio: "inherit" });
const runs = existsSync("recorded") ? readdirSync("recorded").filter((d) => existsSync(`recorded/${d}/replay.json`)) : [];
for (const id of runs) cpSync(`recorded/${id}`, `web/dist/runs/${id}`, { recursive: true });
writeFileSync("web/dist/runs/index.json", JSON.stringify({ runs, default: "live-a-7" }, null, 2));
console.log(`static site in web/dist with runs: ${runs.join(", ")}`);
