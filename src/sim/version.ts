import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 1.0.0 had the package-identity bug (events indexed by id into arrival-sorted arrays). */
export const SIM_VERSION = "1.1.0";

const GRADER_FILES = ["config.ts", "dod.ts", "engine.ts", "evaluate.ts", "layout.ts", "scenarios.ts", "types.ts"];

/**
 * SHA-256 over the simulator and grader sources. Recorded with every experiment;
 * the loop aborts if it changes mid-run, so scores are always from one frozen grader.
 */
export function graderHash(): string {
  const h = createHash("sha256");
  for (const f of GRADER_FILES) {
    h.update(f);
    h.update(readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url))));
  }
  return h.digest("hex");
}
