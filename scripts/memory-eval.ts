// Paired evaluation: shared learned memory (MEM) vs no memory (NOMEM) on fresh factories.
// The only intended difference is the frozen, experiment-backed Playbook. Both arms get identical
// start layouts, Nemotron models/settings, generations, draft-test budget, stop rules, grader, no
// research, no isolated tests and no reflector. Champions are scored once on the locked final split.
// Usage: SEQUENTIAL_DESIGNERS=1 CALL_BUDGET=.. SPEND_CAP_USD=.. node --env-file=<mount> --import tsx
//        scripts/memory-eval.ts <trainingRunId> <factories,comma> <repeats> <gens> <probes>
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crusoe, MODELS, resolveModels, spend, usageLedger } from "../src/llm/crusoe.ts";
import { solve } from "../src/loop/solve.ts";
import { reduce, render, type MemoryOp } from "../src/memory/store.ts";
import type { ReplayBundle } from "../src/replay.ts";
import { DEFAULT_DOD } from "../src/sim/dod.ts";
import { simulate } from "../src/sim/engine.ts";
import { evaluate } from "../src/sim/evaluate.ts";
import { makeScenario, SPLITS, unlockFinal } from "../src/sim/scenarios.ts";
import type { Layout } from "../src/sim/types.ts";
import { graderHash, SIM_VERSION } from "../src/sim/version.ts";
import { loadTask, type FactoryId } from "../src/tasks/task.ts";

if (!process.env.CALL_BUDGET || !process.env.SPEND_CAP_USD) throw new Error("set CALL_BUDGET and SPEND_CAP_USD explicitly");
const [trainingRun, factoriesArg = "factory-f,factory-g", repeatsArg = "2", gensArg = "4", probesArg = "1", maxCallsArg = "60", maxSimsArg = "120"] = process.argv.slice(2);
// Identical hard per-arm maximums (Codex audit): equal generations alone allow unequal repairs/early stops.
const ARM_CAPS = { maxCalls: Number(maxCallsArg), maxSimEvals: Number(maxSimsArg) };
const evalId = `memeval-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const dir = `runs/${evalId}`;
mkdirSync(dir, { recursive: true });
const grader = graderHash();

// 1) Freeze the learned Playbook BEFORE any evaluation factory is loaded.
//    Keep only experiment-backed lessons (observed from accepted experiments or improved in an isolated
//    test); untested web hypotheses are excluded so research availability is identical (none) in both arms.
const trained = JSON.parse(readFileSync(`runs/${trainingRun}/memory.json`, "utf8")) as { ops: MemoryOp[] };
const state = reduce(trained.ops);
const keep = new Set(state.lessons.filter((l) => l.status === "verified").map((l) => l.id));
const frozenOps = trained.ops.filter((o) => keep.has(o.id) && (o.op === "add_verified" || o.op === "add_external" || o.op === "tested"));
const rendered = render(reduce(frozenOps));
const playbookHash = createHash("sha256").update(JSON.stringify(frozenOps)).digest("hex");
writeFileSync(`${dir}/frozen-playbook.json`, JSON.stringify({ trainingRun, frozenAt: new Date().toISOString(), playbookHash, lessons: [...keep], rendered, ops: frozenOps }, null, 2));
console.log(`frozen playbook ${playbookHash.slice(0, 12)} with ${keep.size} lessons from ${trainingRun}`);

// 2) Only now open the evaluation factories.
resolveModels((await crusoe().models.list()).data.map((m) => m.id));
const factories = factoriesArg.split(",") as FactoryId[];
const repeats = Number(repeatsArg), gens = Number(gensArg), probes = Number(probesArg);
unlockFinal(`memory vs no-memory evaluation ${evalId}`);
const finalSeeds = SPLITS.final.map((s) => s.seed);

const scoreFinal = (layout: Layout) => {
  const e = evaluate(layout, "final", DEFAULT_DOD); // scoring only, outside the arms' simulator budget
  const allShipped = e.results.every((r) => r.metrics.unshipped === 0);
  const zeroDamage = e.results.every((r) => r.metrics.damaged === 0);
  return { objective: e.objective, dodPassed: e.dod!.passed, allShipped, zeroDamage, damagedTotal: e.results.reduce((a, r) => a + r.metrics.damaged, 0), scenarios: e.results.length };
};

type ArmResult = { arm: "MEM" | "NOMEM"; runId: string; final: ReturnType<typeof scoreFinal>; train: number; select: number; calls: number; usd: number; simEvals: number; simCalls: unknown; wallMs: number; accepted: number; stopReason: string; champion: Layout };
const pairs: { factory: string; rep: number; order: string[]; MEM: ArmResult; NOMEM: ArmResult; diffObjective: number; outcome: "win" | "tie" | "loss" }[] = [];

for (const factory of factories) {
  const task = loadTask(factory);
  const gen0 = scoreFinal(task.initial);
  for (let rep = 1; rep <= repeats; rep++) {
    const order: ("MEM" | "NOMEM")[] = rep % 2 ? ["NOMEM", "MEM"] : ["MEM", "NOMEM"]; // alternate to cancel drift
    const res: Partial<Record<"MEM" | "NOMEM", ArmResult>> = {};
    for (const arm of order) {
      const runId = `${evalId}-${factory}-r${rep}-${arm}`;
      const ledger0 = usageLedger.length;
      const s = await solve({
        task, generations: gens, runId, probes, sequentialDesigners: process.env.SEQUENTIAL_DESIGNERS === "1",
        research: false, reflect: false, noMemory: arm === "NOMEM", initialOps: arm === "MEM" ? frozenOps : [], ...ARM_CAPS,
        log: (l) => console.log(`[${factory} r${rep} ${arm}] ${l}`),
      });
      const used = usageLedger.slice(ledger0);
      if (s.providerFailures > 0) {
        // Never score a starved arm: abort the whole evaluation and mark it incomplete.
        const reason = `arm ${runId} had ${s.providerFailures} provider/budget-failed proposals (${s.stopReason}); evaluation aborted and marked incomplete`;
        writeFileSync(`${dir}/INCOMPLETE.json`, JSON.stringify({ status: "INCOMPLETE: provider/budget failure", reason, completedPairs: pairs.length, spend: spend() }, null, 2));
        console.error(reason);
        process.exit(2);
      }
      const champion = JSON.parse(readFileSync(`runs/${runId}/champion.json`, "utf8")) as Layout;
      res[arm] = { arm, runId, final: scoreFinal(champion), train: s.champion.train, select: s.champion.select, calls: used.length, usd: used.reduce((a, u) => a + u.usd, 0), simEvals: s.simEvals, simCalls: s.simCalls, wallMs: s.wallMs, accepted: s.accepted, stopReason: s.stopReason, champion };
      console.log(`[${factory} r${rep} ${arm}] final objective ${res[arm]!.final.objective} dod ${res[arm]!.final.dodPassed} zeroDamage ${res[arm]!.final.zeroDamage}`);
    }
    const M = res.MEM!, N = res.NOMEM!;
    const diff = Math.round((M.final.objective - N.final.objective) * 100) / 100;
    const outcome = diff <= -0.01 * N.final.objective ? "win" : diff >= 0.01 * N.final.objective ? "loss" : "tie";
    pairs.push({ factory, rep, order, MEM: M, NOMEM: N, diffObjective: diff, outcome });
    // Persist every pair as it completes, so partial results survive an interruption.
    appendFileSync(`${dir}/pairs.jsonl`, JSON.stringify({ factory, rep, order, diffObjective: diff, outcome, MEM: { ...M, champion: M.champion }, NOMEM: { ...N, champion: N.champion } }) + "\n");

    // Comparison bundle for the 3D viewer: no-memory champion vs memory champion on one final day.
    const scenario = makeScenario(SPLITS.final[1].seed, SPLITS.final[1].profile);
    // Train/select are the champion's development scores on this factory; the locked final split is labeled separately.
    const side = (label: string, layout: Layout, a: ArmResult) => ({
      label, layout, result: simulate(layout, scenario),
      train: { objective: a.train, dodPassed: evaluate(layout, "train", DEFAULT_DOD).dod!.passed },
      select: { objective: a.select, dodPassed: evaluate(layout, "select", DEFAULT_DOD).dod!.passed },
      final: { objective: a.final.objective, dodPassed: a.final.dodPassed, zeroDamage: a.final.zeroDamage, allShipped: a.final.allShipped, damagedTotal: a.final.damagedTotal, scenarios: a.final.scenarios },
    });
    const bundle: ReplayBundle = {
      runId: `${evalId}-${factory}-r${rep}`, mode: "recorded", createdAt: new Date().toISOString(), simVersion: SIM_VERSION, graderHash: grader,
      task: { id: factory, goal: task.goal }, scenario: { id: scenario.id, seed: scenario.seed, profile: scenario.profile },
      baseline: side("No memory", N.champion, N), improved: side("Shared memory", M.champion, M),
      comparators: [{ label: `Gen-0 ${factory}`, train: evaluate(task.initial, "train").objective, select: evaluate(task.initial, "select").objective }],
      accepted: [], rejected: [], lessons: [], curve: [],
      usage: { calls: M.calls + N.calls, usd: M.usd + N.usd, searches: 0, searchUsd: 0 },
    };
    mkdirSync(`runs/${bundle.runId}`, { recursive: true });
    writeFileSync(`runs/${bundle.runId}/replay.json`, JSON.stringify(bundle));
  }
}

const diffs = pairs.map((p) => p.diffObjective).sort((a, b) => a - b);
const median = diffs.length ? (diffs.length % 2 ? diffs[(diffs.length - 1) / 2] : (diffs[diffs.length / 2 - 1] + diffs[diffs.length / 2]) / 2) : null;
const summary = {
  evalId, trainingRun, playbookHash, armCaps: ARM_CAPS, simVersion: SIM_VERSION, graderHash: grader, finalSeeds, factories, repeats, gens, probes,
  factoryHashes: Object.fromEntries(factories.map((f) => [f, createHash("sha256").update(JSON.stringify(loadTask(f).initial)).digest("hex").slice(0, 16)])),
  armSettings: { lenses: "flow 0.3 / quality 0.5 / capacity 0.8 (Super VL)", research: false, isolatedTests: false, reflector: false, gate: ">=1% validation, no DoD regression", stop: "3 stalls or gens" },
  models: { designers: MODELS.super }, n: pairs.length,
  wins: pairs.filter((p) => p.outcome === "win").length, ties: pairs.filter((p) => p.outcome === "tie").length, losses: pairs.filter((p) => p.outcome === "loss").length,
  medianDiffObjective: median, minDiff: diffs[0] ?? null, maxDiff: diffs[diffs.length - 1] ?? null,
  dodPass: { MEM: pairs.filter((p) => p.MEM.final.dodPassed).length, NOMEM: pairs.filter((p) => p.NOMEM.final.dodPassed).length },
  zeroDamage: { MEM: pairs.filter((p) => p.MEM.final.zeroDamage).length, NOMEM: pairs.filter((p) => p.NOMEM.final.zeroDamage).length },
  pairs: pairs.map((p) => ({ ...p, MEM: { ...p.MEM, champion: undefined }, NOMEM: { ...p.NOMEM, champion: undefined } })),
  totalSpend: spend(),
  note: "Objective diff = MEM - NOMEM on the final split (negative favors memory). Win/loss require >=1% difference; otherwise tie.",
};
writeFileSync(`${dir}/results.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, pairs: summary.pairs.map((p) => ({ factory: p.factory, rep: p.rep, MEM: p.MEM.final, NOMEM: p.NOMEM.final, diff: p.diffObjective, outcome: p.outcome, calls: [p.MEM.calls, p.NOMEM.calls], simEvals: [p.MEM.simEvals, p.NOMEM.simEvals] })) }, null, 2));
