// Usage: npm run score -- layouts/baseline.json [train|select|test]
import { readFileSync } from "node:fs";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { evaluate, summarize } from "../src/sim/evaluate.ts";
import type { Split } from "../src/sim/scenarios.ts";
import type { Layout } from "../src/sim/types.ts";

const [path = "layouts/baseline.json", split = "train"] = process.argv.slice(2);
const layout = JSON.parse(readFileSync(path, "utf8")) as Layout;
const e = evaluate(layout, split as Split, DEFAULT_DOD);
const s = summarize(e);

console.log(`\n${s.layout} on ${s.split}: objective ${s.objective}  DoD ${s.dodPassed ? "PASS" : "FAIL"}`);
if (!s.valid) console.log("invalid layout:\n  " + s.errors.join("\n  "));
console.table(
  s.scenarios.map((r) => ({
    scenario: r.id, shipped: r.shipped, makespan: r.makespan, missorts: r.missorts, damaged: r.damaged,
    "pkg/hr": r.throughputPerHour, travel: r.travelCells, capex: r.capex, bottleneck: r.bottleneck, objective: r.objective,
  })),
);
for (const c of e.dod?.checks ?? []) {
  console.log(`  ${c.passed ? "✓" : "✗"} ${c.description} (${c.metric} ${c.op} ${c.value}; got ${c.actual}${c.failing.length ? ` in ${c.failing.join(", ")}` : ""})`);
}
