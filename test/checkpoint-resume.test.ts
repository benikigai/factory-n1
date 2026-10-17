import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = resolve(import.meta.dirname, "..");
const harness = `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { solve } from "./src/loop/solve.ts";
import { guardedChat } from "./src/agents/call-guard.ts";
import { sealDoD } from "./src/dod/lattice.ts";
import { DEFAULT_DOD } from "./src/sim/dod.ts";
import { loadTaskA, validateForTask } from "./src/tasks/task.ts";
const task = loadTaskA();
const mode = process.argv[2];
const approvedDoD = sealDoD({ ...DEFAULT_DOD, checks: DEFAULT_DOD.checks.map(c => c.id === "makespan" && mode === "changed" ? { ...c, value: 1400 } : c) });
const checkpoint = "runs/scripted/checkpoint.json";
let gen = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")).state.generation : 0;
let lensIndex = 0;
const heuristic = { ...task.initial, stations: task.initial.stations.map(s => s.kind === "pack" ? { ...s, sizes: ["S", "M", "L"] } : s) };
await solve({ task, approvedDoD, generations: 4, runId: "scripted", research: false, reflect: false,
  sequentialDesigners: true, maxCalls: 60, maxSimEvals: 120, log: () => {},
  deps: { propose: async ({ lens }) => {
    if (mode === "reserve" && gen === 0 && lensIndex === 0) {
      const pending = guardedChat("offline", { model: "nvidia/NVIDIA-Nemotron-3.5-Super-VL", messages: [{ role: "user", content: "offline" }], max_tokens: 16 });
      console.log("READY_TO_KILL");
      await pending;
    }
    if (mode === "kill" && gen === 1 && lensIndex === 0) {
      appendFileSync("runs/scripted/events.jsonl", '{"partial":true}\\n');
      appendFileSync("runs/scripted/experiments.jsonl", '{"partial":true}\\n');
      console.log("READY_TO_KILL");
      await new Promise(() => setInterval(() => {}, 1000));
    }
    console.log("PROPOSE");
    const layout = gen === 0 && lens.id === "capacity" ? heuristic : task.initial;
    if (++lensIndex === 3) { gen++; lensIndex = 0; }
    return { designer: lens.id, model: "scripted", rationale: "offline", appliedLessons: [], prediction: {}, layout,
      errors: validateForTask(layout, task), via: "tool", toolReceipts: [], probes: [] };
  } },
});
console.log("DONE");
`;

function run(cwd: string, fixture: string, mode: string, kill = false) {
  return new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, ["--import", join(repo, "node_modules/tsx/dist/loader.mjs"), join(fixture, "harness.ts"), mode], {
      cwd, env: { ...process.env, GIT_DIR: execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo, encoding: "utf8" }).trim(), CALL_BUDGET: "60", SPEND_CAP_USD: "0.5", CRUSOE_API_KEY: "offline-test", CRUSOE_BASE_URL: "http://127.0.0.1:1/v1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(new Error(`child timeout: ${output}`)); }, 40_000);
    child.stdout.on("data", (data) => { output += data; if (kill && output.includes("READY_TO_KILL")) child.kill("SIGKILL"); });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (kill ? signal === "SIGKILL" && output.includes("READY_TO_KILL") : code === 0) done(output);
      else fail(new Error(`child failed (${code}/${signal}): ${output}`));
    });
  });
}

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["ts", "wallMs", "createdAt", "elapsedMs"].includes(key)).map(([key, v]) => [key, normalize(v)]));
  return value;
};

test("SIGKILL after generation one resumes once and reproduces the uninterrupted artifacts", { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), "factory-resume-"));
  try {
    cpSync(join(repo, "src"), join(fixture, "src"), { recursive: true });
    cpSync(join(repo, "layouts"), join(fixture, "layouts"), { recursive: true });
    cpSync(join(repo, "package.json"), join(fixture, "package.json"));
    cpSync(join(repo, "tsconfig.json"), join(fixture, "tsconfig.json"));
    symlinkSync(join(repo, "node_modules"), join(fixture, "node_modules"), "dir");
    const solveFile = join(fixture, "src/loop/solve.ts");
    if (!readFileSync(solveFile, "utf8").includes('from "./checkpoint.ts"')) {
      execFileSync("patch", ["-p1", "-i", join(repo, "docs/integration/solve-checkpoint.patch")], { cwd: fixture });
    }
    writeFileSync(join(fixture, "harness.ts"), harness);
    execFileSync(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "--noEmit"], { cwd: fixture });
    const baseline = join(fixture, "baseline"), resumed = join(fixture, "resumed");
    mkdirSync(baseline); mkdirSync(resumed);
    await run(baseline, fixture, "complete");
    await run(resumed, fixture, "kill", true);
    const checkpoint = JSON.parse(readFileSync(join(resumed, "runs/scripted/checkpoint.json"), "utf8"));
    assert.equal(checkpoint.state.generation, 1);
    assert.equal(checkpoint.state.accepted.length, 1);
    assert.equal(checkpoint.state.runtime.calls.cap, 60);
    assert.ok(checkpoint.state.runtime.meter.used > 0);
    const manifest = JSON.parse(readFileSync(join(resumed, "runs/scripted/manifest.json"), "utf8"));
    assert.ok(manifest.manifest.options.approvedDoD.hash, "approved goal hash survives restart");
    await assert.rejects(run(resumed, fixture, "changed"), /manifest mismatch/);
    const after = await run(resumed, fixture, "complete");
    assert.equal(after.match(/PROPOSE/g)?.length, 9, "only generations 2 through 4 rerun");
    for (const file of ["champion.json", "memory.json", "research.json", "replay.json", "summary.json"]) {
      const a = JSON.parse(readFileSync(join(baseline, "runs/scripted", file), "utf8"));
      const b = JSON.parse(readFileSync(join(resumed, "runs/scripted", file), "utf8"));
      assert.deepEqual(normalize(b), normalize(a), file);
    }
    for (const file of ["events.jsonl", "experiments.jsonl"]) {
      const parse = (dir: string) => readFileSync(join(dir, "runs/scripted", file), "utf8").trim().split("\n").map((line) => normalize(JSON.parse(line)));
      assert.deepEqual(parse(resumed), parse(baseline), file);
    }
    const before = readFileSync(join(resumed, "runs/scripted/checkpoint.json"), "utf8");
    assert.doesNotMatch(await run(resumed, fixture, "complete"), /PROPOSE/);
    assert.equal(readFileSync(join(resumed, "runs/scripted/checkpoint.json"), "utf8"), before, "completed resume is a no-op");
    assert.ok(existsSync(join(resumed, "runs/scripted/manifest.json")));
    const uncertain = join(fixture, "uncertain");
    mkdirSync(uncertain);
    await run(uncertain, fixture, "reserve", true);
    const runtime = JSON.parse(readFileSync(join(uncertain, "runs/scripted/runtime.json"), "utf8")).runtime;
    assert.equal(runtime.calls.used, 1);
    assert.equal(runtime.spend.budget.sources.reduce((n: number, s: { attempts: number }) => n + s.attempts, 0), 1);
    assert.ok(runtime.spend.budget.sources.some((s: { reservations: unknown[] }) => s.reservations.length), "in-flight reservation was durable before dispatch");
    await run(uncertain, fixture, "complete");
    const summary = JSON.parse(readFileSync(join(uncertain, "runs/scripted/summary.json"), "utf8"));
    assert.equal(summary.callsUsed, 1, "killed request remains charged to the arm");
    assert.equal(summary.providerAttempts, 1, "killed request remains charged to the process");
    assert.ok(summary.usage.reservedUsd > 0, "unknown provider cost is retained");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
