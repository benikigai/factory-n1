import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyTraining } from "./audit-optimizer-v2-results.ts";
import { verifyContinuationClock } from "./audit-optimizer-v2-continuation.ts";
import { buildingHash, contentHash, layoutHash } from "../src/training/generate.ts";
import { applyAction, optimizerMessages, parseAction } from "../src/training/optimizer.ts";
import { legalMoveActions } from "../src/training/optimizer-data.ts";
import { geometricTeacherPlan } from "../src/training/optimizer-v2-data.ts";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario, SPLITS } from "../src/sim/scenarios.ts";
import { DEFAULT_DOD, evaluateDoD } from "../src/sim/dod.ts";
import { graderHash } from "../src/sim/version.ts";
import { validateForTask } from "../src/tasks/task.ts";

const MODELS = ["factory-optimizer-base", "factory-optimizer-v1", "factory-optimizer-old3", "factory-optimizer-v2"];
const ARMS = [...MODELS, "random", "geometric-teacher"];
const EXCLUDED = "optimizer-v2-test-building-11";
const UNKNOWN = [`${EXCLUDED}-factory-optimizer-v1-1`, "optimizer-v2-test-building-12-factory-optimizer-v2-3"];
const GRADER = "493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4";
const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const lines = (path: string): any[] => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(x => JSON.parse(x));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const eq = (a: unknown, b: unknown, label: string) => assert.deepEqual(a, b, label);
const receipts = (root: string) => readdirSync(root).filter(x => x.endsWith(".json")).map(x => read(join(root, x)));
const excluded = (r: any) => r.caseId === EXCLUDED || r.id.startsWith(EXCLUDED + "-");
const retired = (r: any) => excluded(r) || /-final-(initial|three|twelve)$/.test(r.id);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const stateKey = (id: string, arm: string) => `${id}:${arm}`;
function tree(root: string, prefix = ""): Record<string, string> {
  return Object.assign({}, ...readdirSync(join(root, prefix), { withFileTypes: true }).map(e => {
    assert.equal(e.isSymbolicLink(), false); const path = join(prefix, e.name);
    return e.isDirectory() ? tree(root, path) : { [path]: hash(join(root, path)) };
  }));
}
function budget(requests: any[], simulations: any[]) {
  return Object.fromEntries(ARMS.map(arm => {
    const calls = requests.filter(r => r.arm === arm);
    return [arm, { modelCalls: calls.length, knownTokens: calls.filter(r => r.status === "resolved").reduce((n, r) => n + r.reply.usage.totalTokens, 0), unknownReservedTokens: calls.filter(r => r.status !== "resolved").reduce((n, r) => n + r.reservedTokens, 0), simulations: simulations.filter(r => r.arm === arm).reduce((n, r) => n + r.attempts * r.dayCount, 0) }];
  }));
}

export function auditPartial(rootInput: string, output: string, confirmedTerminated: boolean) {
  assert.equal(confirmedTerminated, true, "Require explicit confirmation that paid work terminated");
  const root = resolve(rootInput), origin = join(root, "origin"), engine = join(root, "engine");
  const manifest = read(join(root, "continuation-manifest.json")), result = read(join(root, "continuation-results.json"));
  const plan = read(join(engine, "evaluation-plan.json")), oldPlan = read(join(origin, "evaluation-plan.json"));
  const checkpoint = read(join(engine, "checkpoint.json")), oldCheckpoint = read(join(origin, "checkpoint.json"));
  const metrics = read(join(engine, "metrics.json")), oldMetrics = read(join(origin, "metrics.json"));
  for (const r of [result, metrics, oldMetrics]) { assert.equal(r.completed, false); assert.equal(r.terminalReason, "provider_failure_charge_unknown"); }
  assert.equal(metrics.internalOnly, true); assert.equal(metrics.internalSearchCompleted, false);
  assert.equal(result.primaryFactoryCount, 19); assert.equal(result.all20Completed, false); assert.equal(result.excludedFactory, EXCLUDED);
  eq(tree(origin), manifest.originHashes, "Immutable failed-run snapshot");
  eq(tree(manifest.originalDirectory), manifest.originHashes, "Original failed directory unchanged");
  for (const [path, digest] of Object.entries(manifest.sourceHashes)) assert.equal(hash(path), digest);
  assert.equal(contentHash(plan), manifest.enginePlanHash); assert.equal(contentHash(oldPlan), manifest.originalPlanHash);
  const { outputDirectory, continuation, maxTokensPerArm, ...policy } = plan;
  eq(policy, Object.fromEntries(Object.entries(oldPlan).filter(([k]) => !["outputDirectory", "maxTokensPerArm"].includes(k))), "No policy change during continuation");
  assert.equal(outputDirectory, engine); assert.equal(continuation.originalPlanHash, manifest.originalPlanHash);
  eq(result.pause, manifest.pause, "Explicit approved pause is retained");
  const timing = verifyContinuationClock(oldCheckpoint, oldMetrics, oldPlan, manifest, checkpoint, result, metrics);
  for (const [path, digest] of Object.entries(plan.sourceHashes)) assert.equal(hash(path), digest);
  assert.equal(plan.graderHash, GRADER); assert.equal(graderHash(), GRADER);
  assert.equal(plan.proposalsPerFactory, 12); assert.equal(plan.maxOutputTokens, 128); assert.equal(plan.temperature, 0); assert.equal(plan.automaticRetries, 0);
  eq(plan.modelAliases, MODELS, "Fixed four-arm model set"); assert.equal(plan.maxModelCalls, 960);
  for (const file of readdirSync(root).filter(x => /^health-\d+\.json$/.test(x))) eq(read(join(root, file)).health, plan.provenance, "Restarted server has identical weights");
  const training = verifyTraining(plan, { confirmedComplete: true, recovered: { v1: "runs/optimizer-recovery/optimizer", old3: "runs/optimizer-v2-recovery/old3", v2: "runs/optimizer-v2-recovery/v2" }, bundle: "runs/optimizer-v2-private/bundle-20261017T223846Z" });
  const data = read(join(plan.dataDirectory, "manifest.json")); assert.equal(hash(join(plan.dataDirectory, "manifest.json")), plan.manifestHash);
  for (const [path, digest] of Object.entries(data.sourceHashes)) assert.equal(hash(path), digest);
  for (const file of ["train.jsonl", "validation.jsonl", "test-factories.jsonl"]) assert.equal(hash(join(plan.dataDirectory, file)), data.files[file].sha256);
  const test = lines(join(plan.dataDirectory, "test-factories.jsonl")).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(test.length, 20); assert.equal(contentHash(test), checkpoint.casesHash);
  const selection = read(join(engine, "selection.json")); eq(selection.ids, test.map(c => c.id), "Original order retained"); assert.equal(selection.hash, contentHash(test));
  eq(manifest.includedIds, test.map(c => c.id).filter(id => id !== EXCLUDED), "Nineteen originally intended paired factories");
  const geometry = new Set([...data.excludedBuildingHashes, ...data.splitBuildingHashes.train, ...data.splitBuildingHashes.validation]);
  const demands = new Set([...data.excludedDemandSeeds, ...data.splitDemandSeeds.train, ...data.splitDemandSeeds.validation, ...Object.values(SPLITS).flat().map(d => d.seed)]);
  for (const c of test) {
    assert.equal(c.buildingHash, buildingHash(c.task)); assert.equal(c.initialLayoutHash, layoutHash(c.initial));
    assert.ok(!geometry.has(c.buildingHash)); geometry.add(c.buildingHash);
    for (const d of [...c.feedbackDays, ...c.finalDays]) { assert.ok(!demands.has(d.seed)); demands.add(d.seed); }
  }

  const oldRequests = receipts(join(origin, "requests")), active = receipts(join(engine, "requests"));
  const oldSims = receipts(join(origin, "simulations")), sims = receipts(join(engine, "simulations"));
  const abandoned = oldRequests.filter(excluded), overhead = oldSims.filter(retired), combined = [...active, ...abandoned];
  const activeById = new Map(active.map(r => [r.id, r])), oldIds = new Set(oldRequests.map(r => r.id));
  for (const r of oldRequests.filter(r => !excluded(r))) eq(activeById.get(r.id), r, "Previously resolved request reused byte-equivalently");
  for (const r of oldSims.filter(r => !retired(r))) eq(sims.find(s => s.id === r.id), r, "Original valid feedback retained");
  assert.ok(active.every(r => !excluded(r))); assert.ok(sims.every(r => !excluded(r)));
  assert.equal(new Set(combined.map(r => r.id)).size, combined.length); assert.equal(combined.length, 108);
  const unknown = combined.filter(r => r.status !== "resolved"); eq(unknown.map(r => r.id).sort(), [...UNKNOWN].sort(), "Only the two documented unresolved calls");
  assert.equal(combined.filter(r => r.status === "resolved").length, 106);
  for (const r of combined) {
    assert.equal(r.requestHash, contentHash(r.request)); assert.equal(r.request.model, r.arm);
    assert.equal(r.request.temperature, 0); assert.equal(r.request.maxOutputTokens, 128);
    assert.equal(r.reservedTokens, Buffer.byteLength(JSON.stringify(r.request.messages), "utf8") + 4096 + 128);
    const inherited = oldIds.has(r.id), start = inherited ? oldCheckpoint.startedAt : timing.resumedAt, end = inherited ? timing.originalEndedAt : timing.effectiveDeadline;
    assert.ok(r.startedAt >= start && r.startedAt < end);
    if (r.status === "resolved") {
      const u = r.reply.usage; for (const k of ["promptTokens", "completionTokens", "totalTokens"]) assert.ok(Number.isSafeInteger(u[k]) && u[k] >= 0);
      assert.equal(u.totalTokens, u.promptTokens + u.completionTokens); assert.ok(u.completionTokens <= 128 && u.totalTokens <= r.reservedTokens); assert.ok(!r.error);
    } else { assert.equal(r.status, "unknown"); assert.equal(r.error, "provider_failure_charge_unknown"); assert.ok(!r.reply); }
  }
  const oldExcluded = oldCheckpoint.states.filter((s: any) => s.caseId === EXCLUDED);
  const accounting = { original: budget(oldRequests, oldSims), active: budget(active, sims), abandonedAndAuditOverhead: budget(abandoned, overhead), combined: budget(combined, [...sims, ...overhead]), originalResolvedRequests: 93, originalUnknownRequests: 1, combinedModelCalls: combined.length, originalCaps: manifest.originalCaps, abandonedPlanning: { simulations: oldExcluded.reduce((n: number, s: any) => n + (s.teacher?.feedbackSimulationCalls ?? 0), 0), elapsedMs: oldExcluded.reduce((n: number, s: any) => n + (s.teacherMs ?? 0), 0) } };
  eq(accounting, result.accounting, "All incurred work and uncertain requests stay in the accounting");
  eq(manifest.abandonedBudget, accounting.abandonedAndAuditOverhead, "Abandoned evidence debit");
  eq(manifest.abandonedRequestIds.sort(), abandoned.map(r => r.id).sort(), "Every abandoned request retained");
  eq(manifest.retiredSimulationIds.sort(), overhead.map(r => r.id).sort(), "Every retired simulation retained");
  const tokenDebit = Math.max(...MODELS.map(arm => accounting.abandonedAndAuditOverhead[arm].knownTokens + accounting.abandonedAndAuditOverhead[arm].unknownReservedTokens));
  assert.equal(maxTokensPerArm, oldPlan.maxTokensPerArm - tokenDebit);
  for (const arm of ARMS) { assert.ok(accounting.combined[arm].knownTokens + accounting.combined[arm].unknownReservedTokens <= oldPlan.maxTokensPerArm); assert.ok(accounting.active[arm].simulations <= plan.maxSimulationsPerArm); }
  for (const s of oldExcluded) eq(checkpoint.states.find((x: any) => x.caseId === s.caseId && x.arm === s.arm), { ...s, stopped: true, continuationExcluded: true }, "Excluded case was never advanced");

  const eligible = test.filter(c => c.id !== EXCLUDED && MODELS.every(arm => {
    const s = checkpoint.states.find((x: any) => x.caseId === c.id && x.arm === arm);
    return s && !s.continuationExcluded && (s.stopped || s.nextRound === 12) && s.final?.initial && s.final?.round3 && s.final?.round12;
  }));
  eq(eligible.map(c => c.id), ["optimizer-v2-test-building-1", "optimizer-v2-test-building-10"], "Eligibility uses completed search, never the measured score");
  const eligibleIds = new Set(eligible.map(c => c.id));
  assert.ok(eligible.every(c => ARMS.every(arm => { const s = checkpoint.states.find((x: any) => x.caseId === c.id && x.arm === arm); return s.stopped || s.nextRound === 12; })), "Both deterministic controls also completed on these same cases");
  const stateMap = new Map<string, any>(eligible.flatMap(c => ARMS.map(arm => [stateKey(c.id, arm), { c, arm, layout: structuredClone(c.initial), nextRound: 0, stopped: false, accepted: 0, invalid: 0, invalidCauses: {}, history: [], feedback: null, snapshot3: null }])));
  let directSimulatorCalls = 0;
  function measure(c: any, arm: string, layout: any, days: any[], stage: string) {
    eq(validateForTask(layout, c.task), [], "Legal independently simulated layout");
    const runs = days.map((d: any) => simulate(layout, makeScenario(d.seed, d.profile, d.count))); directSimulatorCalls += runs.length;
    const dod = evaluateDoD(DEFAULT_DOD, runs), keys = ["objective", "makespan", "damaged", "missorts", "unshipped", "avgWait", "travelCells"];
    const measured: any = Object.fromEntries(keys.map(k => [k, mean(runs.map((r: any) => r.metrics[k]))]));
    const bottlenecks = layout.stations.filter((s: any) => ["sorter", "pack"].includes(s.kind)).map((s: any) => {
      const stats = runs.map((r: any) => r.metrics.stations[s.id]);
      return { stationId: s.id, maxQueue: Math.max(...stats.map((v: any) => v.maxQueue)), totalWait: mean(stats.map((v: any) => v.totalWait)), utilization: mean(stats.map((v: any) => v.utilization)) };
    }).sort((a: any, b: any) => b.totalWait - a.totalWait || a.stationId.localeCompare(b.stationId));
    const value = { valid: true, errors: [], objective: measured.objective, goalMet: dod.passed, checks: dod.checks, metrics: measured, bottlenecks, days: runs.map((r: any) => ({ seed: r.scenario.seed, profile: r.scenario.profile, metrics: r.metrics })) };
    const receipt = sims.find(s => s.id === `${c.id}-${arm}-${stage}`); assert.ok(receipt); assert.equal(receipt.status, "resolved"); assert.equal(receipt.inputHash, contentHash({ layout, days, task: c.task })); eq(receipt.result, value, "Independent simulator equals durable receipt"); return value;
  }
  function accepts(before: any, after: any) {
    if (after.objective >= before.objective - 1e-9) return false;
    const pass = (m: any, check: any) => check.op === "==" ? m[check.metric] === check.value : check.op === "<=" ? m[check.metric] <= check.value : m[check.metric] >= check.value;
    return before.days.every((d: any, i: number) => before.checks.every((check: any) => !pass(d.metrics, check) || pass(after.days[i].metrics, check)));
  }
  const allEvents = [...lines(join(origin, "events.jsonl")), ...lines(join(engine, "events.jsonl"))];
  const steps = allEvents.filter(e => e.type === "step" && eligibleIds.has(e.caseId));
  const usedRequests = new Set<string>(), usedSteps = new Map<string, any>(); let lastRank = -1;
  for (const event of steps) {
    const s = stateMap.get(stateKey(event.caseId, event.arm))!, { c, arm } = s;
    const id = `${c.id}-${arm}-${event.round}`;
    if (usedSteps.has(id)) { eq(usedSteps.get(id), event, "Any replayed step is identical"); continue; }
    usedSteps.set(id, event); assert.equal(s.stopped, false); assert.equal(event.round, s.nextRound);
    const index = test.findIndex(x => x.id === c.id), rotation = (index + event.round) % 4;
    const order = [...MODELS.slice(rotation), ...MODELS.slice(0, rotation), "random", "geometric-teacher"], rank = index * 72 + event.round * 6 + order.indexOf(arm);
    assert.ok(rank > lastRank); lastRank = rank;
    s.feedback ??= measure(c, arm, s.layout, c.feedbackDays, "initial-feedback");
    let raw: string;
    if (arm === "random") raw = JSON.stringify(legalMoveActions(c.task, s.layout, plan.randomSeed + index * 1009 + event.round, 1)[0] ?? { op: "stop" });
    else if (arm === "geometric-teacher") {
      s.teacher ??= geometricTeacherPlan(c.task, c.initial, c.feedbackDays, 12);
      eq(s.teacher, checkpoint.states.find((x: any) => x.caseId === c.id && x.arm === arm).teacher, "Teacher actions recomputed from feedback only"); raw = JSON.stringify(s.teacher.actions?.[event.round] ?? { op: "stop" });
    } else {
      const r = activeById.get(id); assert.ok(r && r.status === "resolved"); usedRequests.add(id);
      const request = { model: arm, messages: optimizerMessages(c.task, s.layout, s.feedback, s.history), temperature: 0, maxOutputTokens: 128 };
      eq(r.request, request, "Reconstructed prompt sees only feedback and prior actions");
      for (const d of c.finalDays) assert.ok(!JSON.stringify(request.messages).includes(String(d.seed)));
      raw = r.reply.content ?? "";
    }
    let action: ReturnType<typeof parseAction> | undefined, candidate: any, invalid: string | undefined;
    try { action = parseAction(raw); candidate = applyAction(c.task, s.layout, action); } catch (e) { invalid = e instanceof Error ? e.message.slice(0, 512) : "Invalid action"; }
    let attempt: any;
    if (invalid) { s.invalid++; s.invalidCauses[invalid] = (s.invalidCauses[invalid] ?? 0) + 1; attempt = { ...(action ? { action } : { rawText: raw.slice(0, 512) }), status: "invalid", reason: invalid }; }
    else if (action!.op === "stop") { s.stopped = true; attempt = { action, status: "stopped" }; }
    else { const m = measure(c, arm, candidate, c.feedbackDays, `candidate-${event.round}`), accepted = accepts(s.feedback, m); attempt = { action, status: accepted ? "accepted" : "rejected", feedback: m }; if (accepted) { s.accepted++; s.layout = candidate; s.feedback = m; } }
    eq(attempt, event.attempt, "Independent legality and feedback acceptance"); assert.equal(event.retainedLayoutHash, layoutHash(s.layout));
    s.history = [...s.history.slice(-2), attempt]; s.nextRound++;
    if (s.nextRound === 3 || s.stopped && !s.snapshot3) s.snapshot3 = structuredClone(s.layout);
  }
  assert.equal(usedRequests.size, active.filter(r => eligibleIds.has(r.caseId)).length);
  for (const s of stateMap.values()) {
    const saved = checkpoint.states.find((x: any) => x.caseId === s.c.id && x.arm === s.arm);
    assert.ok(s.stopped || s.nextRound === 12); assert.ok(s.snapshot3);
    s.final = { initial: measure(s.c, s.arm, s.c.initial, s.c.finalDays, "final-initial"), round3: measure(s.c, s.arm, s.snapshot3, s.c.finalDays, "final-three"), round12: measure(s.c, s.arm, s.layout, s.c.finalDays, "final-twelve") };
    for (const key of ["layout", "nextRound", "stopped", "accepted", "invalid", "history", "feedback", "snapshot3", "final"]) eq(s[key], saved[key], "Reconstructed fully finished state");
  }
  const perFactory = eligible.map(c => ({ id: c.id, arms: Object.fromEntries(ARMS.map(arm => { const s = stateMap.get(stateKey(c.id, arm))!; return [arm, { attemptedProposals: s.nextRound, offeredProposals: 12, stopped: s.stopped, acceptedMoves: s.accepted, invalidActions: s.invalid, invalidCauses: s.invalidCauses, snapshots: Object.fromEntries(["initial", "round3", "round12"].map(name => { const v = s.final[name]; return [name, { objective: v.objective, meanDamagePerDay: v.metrics.damaged, meanMakespan: v.metrics.makespan, totalDamaged: v.days.reduce((n: number, d: any) => n + d.metrics.damaged, 0), zeroDamage: v.days.every((d: any) => d.metrics.damaged === 0), fullGoal: v.goalMet }]; })) }]; })) }));
  const aggregate = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(["initial", "round3", "round12"].map(name => { const values = perFactory.map(c => c.arms[arm].snapshots[name]); return [name, { factories: values.length, factoryDays: values.length * 4, meanObjective: mean(values.map(v => v.objective)), meanDamagePerDay: mean(values.map(v => v.meanDamagePerDay)), meanMakespan: mean(values.map(v => v.meanMakespan)), totalDamaged: values.reduce((n, v) => n + v.totalDamaged, 0), zeroDamageFactories: values.filter(v => v.zeroDamage).length, fullGoalFactories: values.filter(v => v.fullGoal).length }]; }))]));
  const paired = Object.fromEntries(["round3", "round12"].map(name => [name, MODELS.slice(1).map(arm => {
    const deltas = perFactory.map(c => c.arms[arm].snapshots[name].objective - c.arms[MODELS[0]].snapshots[name].objective);
    return { arm, versus: MODELS[0], factories: eligible.length, objectiveWins: deltas.filter(d => d < 0).length, objectiveLosses: deltas.filter(d => d > 0).length, objectiveTies: deltas.filter(d => d === 0).length, meanObjectiveDelta: mean(deltas) };
  })]));
  eq(tree(origin), manifest.originHashes, "Audit leaves origin unchanged");
  const audit = { status: "partial-evidence-verified", createdAt: new Date().toISOString(), intendedComparisonCompleted: false, intendedPrimaryFactories: 19, originalPopulation: 20, primaryWinnerEstablished: false, scope: "Two completed factory pairs only, exploratory and not a valid nineteen-factory model comparison.", eligibilityRule: "All four model arms stopped explicitly or received twelve proposals and have initial, round-three and final measurements; exclude designated interrupted factory 11. No selection by objective score.", eligibleFactoryIds: eligible.map(c => c.id), incompletePrimaryFactoryIds: manifest.includedIds.filter((id: string) => !eligibleIds.has(id)), excludedFactory: EXCLUDED, unknownRequests: unknown.map(r => ({ id: r.id, arm: r.arm, round: r.round, reservedTokens: r.reservedTokens, requestHash: r.requestHash, status: r.status, outputKnown: false })), accounting, totalResolvedCalls: 106, totalUnknownCalls: 2, totalKnownTokens: Object.values(accounting.combined).reduce((n, b) => n + b.knownTokens, 0), totalUnknownReservedTokens: unknown.reduce((n, r) => n + r.reservedTokens, 0), timing, training, directSimulatorCalls, perFactory, aggregate, paired, limitations: ["The original and nineteen-factory continuation both failed; no nineteen- or twenty-factory winner or causal conclusion is established.", "Only the first two lexicographically ordered factories finished. They are an availability-selected exploratory subset and may not represent the full test population.", manifest.disclosure, "The remaining snapshots are fallback measurements of unfinished searches and are not counted as completed model outcomes.", "Two request outputs are unknown and their reservations remain charged against the experiment budget; neither request was retried.", "Single-seed independently retrained artifacts do not isolate epoch count perfectly: archived epoch-one and new epoch-one weights differ.", "The deterministic geometric teacher uses privileged search and must not be described as a compute-matched model.", "Final scoring order relies on frozen evaluator control flow. Simulation receipts do not contain timestamps."], hashes: { plan: hash(join(engine, "evaluation-plan.json")), planContent: contentHash(plan), testData: hash(join(plan.dataDirectory, "test-factories.jsonl")), dataManifest: hash(join(plan.dataDirectory, "manifest.json")), originalTree: contentHash(manifest.originHashes), manifest: hash(join(root, "continuation-manifest.json")), continuationResults: hash(join(root, "continuation-results.json")), engineMetrics: hash(join(engine, "metrics.json")), grader: GRADER } };
  assert.ok(!existsSync(output), "Never overwrite prior audit evidence"); writeFileSync(output, JSON.stringify(audit, null, 2) + "\n", { flag: "wx" }); return audit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, root, output] = process.argv.slice(2); assert.ok(root && output);
  const audit = auditPartial(root, output, flag === "--confirmed-terminated");
  console.log(JSON.stringify({ status: audit.status, intendedComparisonCompleted: false, eligibleFactoryIds: audit.eligibleFactoryIds, aggregate: audit.aggregate, paired: audit.paired, directSimulatorCalls: audit.directSimulatorCalls, totalKnownTokens: audit.totalKnownTokens, totalUnknownReservedTokens: audit.totalUnknownReservedTokens, timing: audit.timing }, null, 2));
}
