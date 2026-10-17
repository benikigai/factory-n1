import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { LIMITS, MODELS } from "../src/llm/crusoe.ts";
import { bindManifest } from "../src/loop/checkpoint.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { SPLITS, unlockFinal } from "../src/sim/scenarios.ts";
import { graderHash } from "../src/sim/version.ts";
import { loadTask } from "../src/tasks/task.ts";

test("memory evaluation resumes completed pairs without provider access or duplicate rows", () => {
  const repo = resolve(import.meta.dirname, "..");
  const fixture = mkdtempSync(join(tmpdir(), "factory-memory-resume-"));
  try {
    cpSync(join(repo, "src"), join(fixture, "src"), { recursive: true });
    cpSync(join(repo, "layouts"), join(fixture, "layouts"), { recursive: true });
    cpSync(join(repo, "package.json"), join(fixture, "package.json"));
    mkdirSync(join(fixture, "scripts"));
    cpSync(join(repo, "scripts/memory-eval.ts"), join(fixture, "scripts/memory-eval.ts"));
    symlinkSync(join(repo, "node_modules"), join(fixture, "node_modules"), "dir");
    const task = loadTask("factory-f");
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const dir = join(fixture, "runs/eval-resume");
    mkdirSync(join(fixture, "runs/training"), { recursive: true });
    writeFileSync(join(fixture, "runs/training/memory.json"), '{"ops":[]}');
    bindManifest(dir, {
      task: { trainingRun: "training", playbookHash: createHash("sha256").update("[]").digest("hex"), factories: [task] },
      gitCommit, graderHash: graderHash(), options: {
        repeats: 1, gens: 4, probes: 1, maxCalls: 60, maxSimEvals: 120, sequentialDesigners: false,
        models: MODELS, processCaps: LIMITS, finalSeeds: SPLITS.final.map((s) => s.seed),
      },
    });
    unlockFinal("offline completed-pair fixture");
    const final = evaluate(task.initial, "final", DEFAULT_DOD);
    const arm = (name: string) => ({
      arm: name, runId: `eval-resume-factory-f-r1-${name}`, champion: task.initial,
      final: { objective: final.objective, dodPassed: final.dod!.passed, allShipped: final.results.every((r) => !r.metrics.unshipped), zeroDamage: false, damagedTotal: final.results.reduce((n, r) => n + r.metrics.damaged, 0), scenarios: final.results.length },
      train: evaluate(task.initial, "train").objective, select: evaluate(task.initial, "select").objective,
      calls: 0, usd: 0, simEvals: 0, simCalls: {}, wallMs: 0, accepted: 0, stopReason: "offline fixture",
    });
    const row = { factory: "factory-f", rep: 1, order: ["NOMEM", "MEM"], MEM: arm("MEM"), NOMEM: arm("NOMEM"), diffObjective: 0, outcome: "tie" };
    const pairsPath = join(dir, "pairs.jsonl");
    const persisted = JSON.stringify(row) + "\n";
    writeFileSync(pairsPath, persisted);
    const run = () => execFileSync(process.execPath, ["--import", join(repo, "node_modules/tsx/dist/loader.mjs"), "scripts/memory-eval.ts", "training", "factory-f", "1", "4", "1", "60", "120"], {
      cwd: fixture, encoding: "utf8", timeout: 20_000, env: {
        ...process.env, CRUSOE_API_KEY: "", MEMORY_EVAL_ID: "eval-resume", SEQUENTIAL_DESIGNERS: "0",
        CALL_BUDGET: String(LIMITS.calls), SPEND_CAP_USD: String(LIMITS.usd),
        GIT_DIR: execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo, encoding: "utf8" }).trim(),
      },
    });
    assert.match(run(), /persisted pair skipped/);
    assert.match(run(), /persisted pair skipped/);
    assert.equal(readFileSync(pairsPath, "utf8"), persisted);
    const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
    assert.equal(results.gitCommit, gitCommit);
    assert.equal(results.n, 1);
    assert.equal(results.ties, 1);
    assert.equal(results.totalSpend.calls, 0);
    assert.equal(results.pairs[0].MEM.champion, undefined);
    assert.ok(readFileSync(join(fixture, "runs/eval-resume-factory-f-r1/replay.json"), "utf8"), "missing comparison artifact was rebuilt");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
