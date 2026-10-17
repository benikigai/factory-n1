// The public static site excludes local operator and presenter tools.
// build-static.ts calls this on web/dist and fails the build on any hit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const FORBIDDEN = ["/api/run", "/api/inspect", "INSPECT_OUT_DIR", "child_process", "FACTORY_ENV_FILE", "--env-file", "CRUSOE_API_KEY", "YDC_API_KEY", "mountRunLive", "spawn(", "1-minute walkthrough", "4-minute detailed walkthrough", "Pause timer"];

export function findForbidden(dir: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const file = path.join(d, name);
      if (statSync(file).isDirectory()) {
        if (path.relative(dir, file) === "runs") continue; // recorded data, not code
        walk(file);
      } else if (/\.(js|mjs|html|css|map)$/.test(name)) {
        const text = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${path.relative(dir, file)}: ${needle}`);
      }
    }
  };
  walk(dir);
  return hits;
}
