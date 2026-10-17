/**
 * One full learning run on a task:
 *   goal -> You.com research -> shared memory -> Nemotron proposals -> frozen simulator
 *   -> accept/reject (code) -> causal receipts -> memory update -> next generation.
 *
 * Every number shown to people or written to memory comes from the simulator, never
 * from a model's narration. Artifacts land in runs/<runId>/.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { LENSES, propose, type Proposal } from "../agents/designer.ts";
import { reflect } from "../agents/reflector.ts";
import { hillclimb } from "../baselines/hillclimb.ts";
import { MODELS, spend, usageLedger } from "../llm/crusoe.ts";
import { createYouSearch } from "../llm/you-search.ts";
import { attribute } from "../memory/attribution.ts";
import { observe } from "./observe.ts";
import { research } from "../memory/research.ts";
import { testHypothesis } from "../memory/hypothesis-test.ts";
import { reduce, render, retirements, toCited, type Evidence, type MemoryOp } from "../memory/store.ts";
import type { AcceptedChange, RejectedCandidate, ReplayBundle, ReplaySide } from "../replay.ts";
import { DEFAULT_DOD, type DoDResult } from "../sim/dod.ts";
import { simulate } from "../sim/engine.ts";
import { evaluate, type Evaluation } from "../sim/evaluate.ts";
import { makeScenario, SPLITS } from "../sim/scenarios.ts";
import type { Layout } from "../sim/types.ts";
import { graderHash, SIM_VERSION } from "../sim/version.ts";
import type { Task } from "../tasks/task.ts";

export interface SolveOptions {
  task: Task;
  generations: number;
  runId?: string;
  /** Max You.com searches: one at planning, one more if the team stalls. */
  searches?: number;
  /** Required select improvement to accept, as a fraction (0.01 = 1%). */
  margin?: number;
  log?: (line: string) => void;
  /** Draft tests each designer may run with simulate_layout per generation (each counts as a sim eval). */
  probes?: number;
  /** Injection points for offline tests; default to the live Nemotron agents. */
  deps?: { propose?: typeof propose; reflect?: typeof reflect; research?: typeof research; testHypothesis?: typeof testHypothesis };
}

const hashLayout = (l: Layout) =>
  createHash("sha256")
    .update(JSON.stringify([...l.stations].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.kind, s.x, s.y, [...(s.zones ?? [])].sort(), [...(s.sizes ?? [])].sort()])))
    .digest("hex")
    .slice(0, 12);

const avg = (e: Evaluation, k: "objective" | "makespan" | "missorts" | "damaged" | "throughputPerHour") =>
  Math.round((e.results.reduce((a, r) => a + r.metrics[k], 0) / e.results.length) * 100) / 100;

const metricsOf = (e: Evaluation) => ({
  objective: e.objective,
  makespan: avg(e, "makespan"),
  missorts: avg(e, "missorts"),
  damaged: avg(e, "damaged"),
});

/** DoD checks the champion passes that the candidate fails: a regression the gate refuses. */
const regressions = (champ: DoDResult, cand: DoDResult) =>
  champ.checks.filter((c) => c.passed && !cand.checks.find((x) => x.id === c.id)?.passed).map((c) => c.id);

function stateText(champion: Layout, train: Evaluation, rejected: RejectedCandidate[]): string {
  const recent = rejected
    .slice(-6)
    .map((r) => `- ${r.candidateId} (${r.designer}): ${r.reason}${r.trainObjective !== null ? `, train objective ${r.trainObjective}` : ""}${r.edits?.length ? `. Edits tried: ${r.edits.join("; ")}` : ""}`)
    .join("\n");
  return `CURRENT CHAMPION LAYOUT:\n${JSON.stringify(champion)}\n\n${observe(train)}\n\nRECENTLY REJECTED PROPOSALS (don't repeat them):\n${recent || "- none yet"}`;
}

function sharedPrefix(task: Task, memory: string): string {
  const fixed = task.initial.stations.filter((s) => task.fixed.includes(s.id));
  return `You are a designer on an agent team improving the floor layout of a parcel fulfillment center (a queueing simulation).
Flow: every package arrives at a receiving dock -> a sorter -> a pack station -> the shipping dock for its zone. Packages have a zone (A, B, C), a size (S, M, L) and may be fragile. They move between stations on conveyors along grid paths.

GOAL: ${task.goal}

FIXED BY THE BUILDING (copy these exactly, never move or change them): ${JSON.stringify(fixed)}
YOU MAY EDIT: ${task.editable.sorter[0]}-${task.editable.sorter[1]} sorter stations and ${task.editable.pack[0]}-${task.editable.pack[1]} pack stations: their positions, and for pack stations the zones and sizes they accept.
RULES: grid ${task.initial.grid.w}x${task.initial.grid.h} (x 0..${task.initial.grid.w - 1}, y 0..${task.initial.grid.h - 1}); integer coordinates; any two stations at least 2 cells apart in x or y (Chebyshev distance >= 2); unique ids; capex cap $${task.capexCap} (sorter $50k, pack $20k, dock $30k).
SCORING (lower is better, averaged over several package days): makespan seconds + 300 per mis-sorted package + 600 per damaged package + 3600 per unshipped package + capex/100. A proposal is kept only if it beats the current champion by at least 1% on separate validation days.

${memory}`;
}

export async function solve(opts: SolveOptions) {
  const { task, generations } = opts;
  const margin = opts.margin ?? 0.01;
  const log = opts.log ?? ((l: string) => console.log(l));
  const runId = opts.runId ?? `solve-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dir = `runs/${runId}`;
  mkdirSync(dir, { recursive: true });
  const grader = graderHash();
  const taskHash = createHash("sha256").update(JSON.stringify(task)).digest("hex").slice(0, 16);
  const event = (type: string, data: object) => appendFileSync(`${dir}/events.jsonl`, JSON.stringify({ runId, ts: Date.now(), type, ...data }) + "\n");
  const record = (r: object) =>
    appendFileSync(
      `${dir}/experiments.jsonl`,
      JSON.stringify({ runId, taskId: task.id, taskHash, simVersion: SIM_VERSION, graderHash: grader, trainSeeds: SPLITS.train.map((s) => s.seed), selectSeeds: SPLITS.select.map((s) => s.seed), dataUse: "development (train/select); never final evaluation", ...r }) + "\n",
    );

  const search = createYouSearch({ maxCalls: opts.searches ?? 2 });
  const proposeFn = opts.deps?.propose ?? propose;
  const reflectFn = opts.deps?.reflect ?? reflect;
  const researchFn = opts.deps?.research ?? research;
  const testFn = opts.deps?.testHypothesis ?? testHypothesis;
  const ops: MemoryOp[] = [];
  const dod = DEFAULT_DOD;

  let champion = task.initial;
  let champId = "gen0";
  let champTrain = evaluate(champion, "train", dod);
  let champSelect = evaluate(champion, "select", dod);
  const baselineTrain = champTrain;
  const baselineSelect = champSelect;
  const seen = new Set([hashLayout(champion)]);
  const accepted: AcceptedChange[] = [];
  const rejected: RejectedCandidate[] = [];
  const curve: ReplayBundle["curve"] = [{ gen: 0, championSelect: champSelect.objective, candidates: [] }];
  const researchLog: object[] = [];
  let stalled = 0;
  let stopReason = `reached ${generations} generations`;
  event("run_started", { taskId: task.id, goal: task.goal, models: MODELS, generations, simVersion: SIM_VERSION, graderHash: grader });
  log(`[${runId}] gen0 champion: train ${champTrain.objective}, select ${champSelect.objective}, DoD ${champSelect.dod!.passed ? "pass" : "fail"}`);

  let simEvals = 0;
  const doResearch = async (gap: string, prefix: string, gen: number) => {
    let out: Awaited<ReturnType<typeof research>>;
    try {
      out = await researchFn({ search, goal: task.goal, gap, idPrefix: prefix });
    } catch (e) {
      out = { ops: [], query: null, sources: [], receiptId: null, citationRepairs: 0, dropped: [], error: `research failed: ${String((e as Error).message).slice(0, 120)}` };
    }
    ops.push(...out.ops);
    researchLog.push({ gap, ...out });
    event("research", { query: out.query, sources: out.sources.map((s) => s.url), added: out.ops.length, dropped: out.dropped, citationRepairs: out.citationRepairs, error: out.error });
    log(`  research: ${out.error ?? `"${out.query}" -> ${out.ops.length} hypotheses (${out.dropped.length} dropped, ${out.citationRepairs} citation repairs)`}`);

    // Isolated test of each new hypothesis against the current champion. Only this can promote it.
    for (const added of out.ops) {
      const lesson = reduce(ops).lessons.find((l) => l.id === added.id);
      if (!lesson) continue;
      const t = await testFn({ task, lesson, champion, championSelect: champSelect, gen, margin });
      simEvals += t.simEvals;
      if (t.op) ops.push(t.op);
      const regress = t.select ? regressions(champSelect.dod!, t.select.dod!) : [];
      const adopt = t.improved && t.layout && t.train && t.select && !regress.length;
      log(`  test ${lesson.id}: ${t.untestable ?? `validation ${t.select!.objective} vs champion ${champSelect.objective} -> ${t.improved ? (adopt ? "IMPROVED, adopted" : `improved but regresses ${regress.join(",")}`) : "no improvement"}`}`);
      event("hypothesis_test", { id: lesson.id, untestable: t.untestable ?? null, improved: t.improved, adopted: Boolean(adopt), deltaSelect: t.op?.op === "tested" ? t.op.evidence.deltaSelect : null });
      record({
        gen, candidateId: `test-${lesson.id}`, designer: "hypothesis-test", model: MODELS.lightning, via: "isolated-test", toolReceipts: [],
        beforeLayoutHash: hashLayout(champion), candidateLayoutHash: t.layout ? hashLayout(t.layout) : null, candidateLayout: t.layout,
        diff: t.op?.op === "tested" ? (t.op.evidence.edits ?? []).map((e) => e.edit) : [], rationale: lesson.text, appliedLessons: [lesson.id],
        playbookVersion: reduce(ops).version, prediction: {}, measuredTrain: t.train ? metricsOf(t.train) : null, measuredSelect: t.select ? metricsOf(t.select) : null,
        claimRefuted: null, decision: adopt ? "accepted" : "rejected", reason: t.untestable ?? (adopt ? "isolated hypothesis test improved validation" : "isolated hypothesis test did not improve validation"),
      });
      if (adopt) {
        const receipts = t.op!.op === "tested" ? t.op!.evidence.edits ?? [] : [];
        accepted.push({
          gen, candidateId: `test-${lesson.id}`, designer: `hypothesis test (${MODELS.lightning})`, rationale: `Isolated test of research hypothesis: ${lesson.text}`,
          selectBefore: champSelect.objective, selectAfter: t.select!.objective, edits: receipts, appliedLessons: [lesson.id],
        });
        champion = t.layout!;
        champId = `test-${lesson.id}`;
        champTrain = t.train!;
        champSelect = t.select!;
        seen.add(hashLayout(champion));
      }
    }
  };

  const failingNow = champTrain.dod!.checks.filter((c) => !c.passed).map((c) => `${c.description} (got ${c.actual})`).join("; ");
  const bottleneck = champTrain.results[0]?.metrics.bottleneck;
  await doResearch(`Failing checks: ${failingNow}. Biggest queue at ${bottleneck}. Packages are damaged in transit and mis-sorted.`, "EXT-plan", 0);

  const writeReplay = (mode: ReplayBundle["mode"], comparators: ReplayBundle["comparators"]) => {
    const scenario = makeScenario(202, "peak");
    const side = (label: string, layout: Layout, train: Evaluation, select: Evaluation): ReplaySide => ({
      label, layout, result: simulate(layout, scenario),
      train: { objective: train.objective, dodPassed: train.dod!.passed },
      select: { objective: select.objective, dodPassed: select.dod!.passed },
    });
    const s = spend();
    const bundle: ReplayBundle = {
      runId, mode, createdAt: new Date().toISOString(), simVersion: SIM_VERSION, graderHash: grader,
      task: { id: task.id, goal: task.goal },
      scenario: { id: scenario.id, seed: scenario.seed, profile: scenario.profile },
      baseline: side("Gen-0 baseline", task.initial, baselineTrain, baselineSelect),
      improved: side(accepted.length ? `Agent champion (${champId})` : "Agent champion (no accepted change)", champion, champTrain, champSelect),
      comparators, accepted, rejected, lessons: toCited(reduce(ops)), curve,
      usage: { calls: s.calls, usd: Math.round(s.usd * 1e6) / 1e6, searches: search.usage().attempts, searchUsd: search.usage().estimatedUsd },
    };
    writeFileSync(`${dir}/replay.json`, JSON.stringify(bundle));
  };
  writeReplay("live", []);

  try {
  for (let gen = 1; gen <= generations; gen++) {
    if (graderHash() !== grader) throw new Error("grader source changed during the run; aborting");
    const memory = reduce(ops);
    const prefix = sharedPrefix(task, render(memory));
    const state = stateText(champion, champTrain, rejected);
    const ledgerStart = usageLedger.length;
    log(`gen ${gen}: ${LENSES.length} designers reading playbook v${memory.version} (${memory.lessons.filter((l) => l.status !== "retired").length} lessons)`);
    const proposals = await Promise.all(LENSES.map((lens) => proposeFn({ task, lens, sharedPrefix: prefix, state, probes: opts.probes ?? 0 })));

    simEvals += proposals.reduce((a, p) => a + (p.probes?.filter((x) => x.objective !== null).length ?? 0), 0);
    type Scored = { p: Proposal; id: string; hash: string | null; train: Evaluation | null; dup: boolean };
    const scored: Scored[] = proposals.map((p) => {
      const id = `g${gen}-${p.designer}`;
      if (!p.layout || p.errors.length) return { p, id, hash: null, train: null, dup: false };
      const hash = hashLayout(p.layout);
      if (seen.has(hash)) return { p, id, hash, train: null, dup: true };
      seen.add(hash);
      simEvals++;
      return { p, id, hash, train: evaluate(p.layout, "train", dod), dup: false };
    });

    const valid = scored.filter((s) => s.train).sort((a, b) => a.train!.objective - b.train!.objective);
    const best = valid[0];
    let winner: Scored | null = null;
    let bestSelect: Evaluation | null = null;
    let gateReason = "";
    if (best && best.train!.objective < champTrain.objective) {
      bestSelect = evaluate(best.p.layout!, "select", dod);
      simEvals++;
      const regress = regressions(champSelect.dod!, bestSelect.dod!);
      if (bestSelect.objective <= champSelect.objective * (1 - margin) && !regress.length) winner = best;
      else gateReason = regress.length ? `regresses goal checks on validation days: ${regress.join(", ")}` : `validation objective ${bestSelect.objective} not >=${margin * 100}% better than champion ${champSelect.objective}`;
    }

    const memOps: MemoryOp[] = [];
    let acceptedEvidence: Evidence | null = null;
    for (const s of scored) {
      const isWinner = s === winner;
      const reason = isWinner
        ? "accepted"
        : !s.p.layout || s.p.errors.length
          ? `invalid: ${s.p.errors.slice(0, 3).join("; ") || "no layout"}`
          : s.dup
            ? s.hash === hashLayout(champion) ? "resubmitted the champion unchanged" : "duplicate of an earlier layout"
            : s === best
              ? gateReason || `train objective ${s.train!.objective} not better than champion ${champTrain.objective}`
              : `not the best proposal this generation (train ${s.train!.objective})`;
      const deltaSelect = isWinner ? Math.round((bestSelect!.objective - champSelect.objective) * 100) / 100 : s === best && bestSelect ? Math.round((bestSelect.objective - champSelect.objective) * 100) / 100 : null;
      const predicted = typeof s.p.prediction.objective === "number" ? s.p.prediction.objective : null;
      const measured = s.train?.objective ?? null;
      const claimRefuted = predicted !== null && measured !== null ? Math.abs(predicted - measured) / measured > 0.25 : null;
      const evidence: Evidence = { gen, candidateId: s.id, accepted: isWinner, deltaSelect };
      const known = new Set(reduce([...ops, ...memOps]).lessons.map((l) => l.id));
      // Citations are recorded, never treated as evidence that the lesson was implemented or worked.
      for (const lid of s.p.appliedLessons.filter((x) => known.has(x))) memOps.push({ op: "cited", id: lid, evidence });

      if (isWinner) {
        // Causal receipts: each edit scored alone by the simulator. Edits that aren't valid alone are marked, not zeroed silently.
        const receipts = attribute(champion, s.p.layout!).map((e) => ({
          edit: e.deltaAlone === null ? `${e.edit} (not valid on its own)` : e.edit,
          deltaAlone: e.deltaAlone ?? 0,
        }));
        acceptedEvidence = { ...evidence, edits: receipts };
        accepted.push({
          gen, candidateId: s.id, designer: `${s.p.designer} (${s.p.model})`, rationale: s.p.rationale,
          selectBefore: champSelect.objective, selectAfter: bestSelect!.objective,
          edits: receipts,
          appliedLessons: s.p.appliedLessons, prediction: s.p.prediction, claimRefuted: claimRefuted ?? undefined,
        });
      } else {
        rejected.push({
          gen, candidateId: s.id, designer: `${s.p.designer} (${s.p.model})`, rationale: s.p.rationale, reason,
          trainObjective: measured, errors: s.p.errors, layout: s.p.layout,
          edits: s.p.layout && !s.p.errors.length ? attribute(champion, s.p.layout).map((e) => e.edit) : [],
        });
      }
      record({
        gen, candidateId: s.id, designer: s.p.designer, model: s.p.model, via: s.p.via, toolReceipts: s.p.toolReceipts,
        beforeLayoutHash: hashLayout(champion), candidateLayoutHash: s.hash, candidateLayout: s.p.layout,
        diff: s.p.layout && !s.p.errors.length ? attribute(champion, s.p.layout).map((e) => e.edit) : [],
        rationale: s.p.rationale, appliedLessons: s.p.appliedLessons, playbookVersion: memory.version,
        prediction: s.p.prediction, measuredTrain: s.train ? metricsOf(s.train) : null,
        measuredSelect: s === best && bestSelect ? metricsOf(bestSelect) : null,
        claimRefuted, decision: isWinner ? "accepted" : "rejected", reason,
      });
      log(`  ${s.id} [${s.p.via}] ${isWinner ? "ACCEPTED" : "rejected"}: ${reason}${claimRefuted ? " | CLAIM REFUTED" : ""}`);
    }

    curve.push({
      gen,
      championSelect: winner ? bestSelect!.objective : champSelect.objective,
      candidates: scored.map((s) => ({ id: s.id, train: s.train?.objective ?? null, accepted: s === winner })),
    });

    if (winner && acceptedEvidence) {
      const before = metricsOf(champTrain);
      champion = winner.p.layout!;
      champId = winner.id;
      champTrain = winner.train!;
      champSelect = bestSelect!;
      stalled = 0;
      const lesson = await reflectFn({ id: `VER-g${gen}`, evidence: acceptedEvidence, rationale: winner.p.rationale, before, after: metricsOf(champTrain) });
      if (lesson) memOps.push(lesson);
    } else {
      stalled++;
      // Review what didn't work: the best valid rejected candidate's per-edit receipts, computed by code.
      const tried = valid.find((v) => v.p.layout && hashLayout(v.p.layout) !== hashLayout(champion));
      if (stalled === 1 && tried) {
        const edits = attribute(champion, tried.p.layout!).map((e) => ({ edit: e.deltaAlone === null ? `${e.edit} (not valid on its own)` : e.edit, deltaAlone: e.deltaAlone ?? 0 }));
        const evidence: Evidence = { gen, candidateId: tried.id, accepted: false, deltaSelect: null, edits };
        const lesson = await reflectFn({ id: `VER-g${gen}-avoid`, evidence, rationale: tried.p.rationale, before: metricsOf(champTrain), after: metricsOf(tried.train!), outcome: "stall" });
        if (lesson) memOps.push(lesson);
      }
    }
    ops.push(...memOps);
    ops.push(...retirements(reduce(ops)));

    const genUsage = usageLedger.slice(ledgerStart);
    event("generation", {
      gen, accepted: winner?.id ?? null, championTrain: champTrain.objective, championSelect: champSelect.objective,
      memoryVersion: reduce(ops).version, calls: genUsage.length, usd: genUsage.reduce((a, u) => a + u.usd, 0),
      cachedTokens: genUsage.reduce((a, u) => a + u.cachedTokens, 0), promptTokens: genUsage.reduce((a, u) => a + u.promptTokens, 0),
    });
    writeReplay("live", []);

    // Supervisor (code): done, re-plan with research, or stop.
    if (champSelect.dod!.passed && stalled >= 2) {
      stopReason = "goal met on validation days and no further gains for 2 generations";
      break;
    }
    if (stalled === 2 && search.usage().attempts < (opts.searches ?? 2)) {
      log("  supervisor: 2 generations without an accepted change -> re-plan with targeted research");
      const worst = champTrain.dod!.checks.filter((c) => !c.passed).map((c) => `${c.description} (got ${c.actual})`).join("; ");
      await doResearch(`Stalled. Still failing: ${worst || "none"}. Bottleneck ${champTrain.results[0]?.metrics.bottleneck}.`, `EXT-g${gen}`, gen);
    }
    if (stalled >= 3) {
      stopReason = "3 generations without an accepted change";
      break;
    }
  }
  } catch (e) {
    // Provider failures end the run early but never lose the artifacts.
    stopReason = `stopped early on error: ${String((e as Error).message).slice(0, 160)}`;
    log(`  ${stopReason}`);
  }

  // Comparators computed by code at the same simulator-evaluation budget.
  const heuristic: Layout = { ...task.initial, name: "code-heuristic", stations: task.initial.stations.map((s) => (s.kind === "pack" ? { ...s, sizes: ["S", "M", "L"] } : s)) };
  const climb = hillclimb(task, Math.max(1, simEvals), 1);
  const comparators = [
    { label: "Code heuristic: pack stations accept all sizes", train: evaluate(heuristic, "train").objective, select: evaluate(heuristic, "select").objective },
    { label: `Random hill-climber at equal budget (${climb.evalsUsed} sim evals)`, train: climb.train, select: climb.select },
  ];
  writeReplay("recorded", comparators);
  const finalState = reduce(ops);
  writeFileSync(`${dir}/memory.json`, JSON.stringify({ ops, state: finalState }, null, 2));
  writeFileSync(`${dir}/champion.json`, JSON.stringify(champion, null, 2));
  writeFileSync(`${dir}/research.json`, JSON.stringify(researchLog, null, 2));
  const s = spend();
  const summary = {
    runId, taskId: task.id, stopReason, simVersion: SIM_VERSION, graderHash: grader, simEvals,
    baseline: { train: baselineTrain.objective, select: baselineSelect.objective, dodSelect: baselineSelect.dod!.passed },
    champion: { id: champId, train: champTrain.objective, select: champSelect.objective, dodSelect: champSelect.dod!.passed },
    improvementSelectPct: Math.round((1 - champSelect.objective / baselineSelect.objective) * 10000) / 100,
    comparators, accepted: accepted.length, rejected: rejected.length,
    lessons: finalState.lessons.map((l) => ({ id: l.id, kind: l.kind, status: l.status, helped: l.helped, trials: l.trials })),
    usage: { ...s, searches: search.usage() },
  };
  writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  event("run_finished", summary);
  return summary;
}
