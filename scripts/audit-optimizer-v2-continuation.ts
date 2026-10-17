import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditV2Results } from "./audit-optimizer-v2-results.ts";
import { contentHash } from "../src/training/generate.ts";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario } from "../src/sim/scenarios.ts";
import { DEFAULT_DOD, evaluateDoD } from "../src/sim/dod.ts";
import { validateForTask } from "../src/tasks/task.ts";

const EXCLUDED = "optimizer-v2-test-building-11";
const UNKNOWN = `${EXCLUDED}-factory-optimizer-v1-1`;
const ARMS = ["factory-optimizer-base", "factory-optimizer-v1", "factory-optimizer-old3", "factory-optimizer-v2", "random", "geometric-teacher"];
const json = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const lines = (path: string): any[] => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const eq = (a: unknown, b: unknown, reason: string) => assert.deepEqual(a, b, reason);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const receipts = (root: string) => readdirSync(root).filter(file => file.endsWith(".json")).map(file => json(join(root, file)));
const excluded = (receipt: any) => receipt.caseId === EXCLUDED || receipt.id.startsWith(`${EXCLUDED}-`);
const retired = (receipt: any) => excluded(receipt) || /-final-(initial|three|twelve)$/.test(receipt.id);

function tree(root: string, prefix = ""): Record<string, string> {
  return Object.assign({}, ...readdirSync(join(root, prefix), { withFileTypes: true }).map(entry => {
    assert.equal(entry.isSymbolicLink(), false, "Evidence contains no symlinks");
    const name = join(prefix, entry.name);
    return entry.isDirectory() ? tree(root, name) : { [name]: hash(join(root, name)) };
  }));
}
function budgets(requests: any[], simulations: any[]) {
  return Object.fromEntries(ARMS.map(arm => {
    const calls = requests.filter(r => r.arm === arm), runs = simulations.filter(r => r.arm === arm);
    for (const call of calls) {
      assert.ok(Number.isSafeInteger(call.reservedTokens) && call.reservedTokens >= 0);
      if (call.status === "resolved") {
        const u = call.reply.usage;
        for (const key of ["promptTokens", "completionTokens", "totalTokens"]) assert.ok(Number.isSafeInteger(u[key]) && u[key] >= 0);
        assert.equal(u.totalTokens, u.promptTokens + u.completionTokens); assert.ok(u.completionTokens <= 128 && u.totalTokens <= call.reservedTokens);
      }
    }
    for (const run of runs) assert.ok(Number.isSafeInteger(run.attempts) && run.attempts >= 1 && run.dayCount === 4);
    return [arm, { modelCalls: calls.length, knownTokens: calls.filter(r => r.status === "resolved").reduce((sum, r) => sum + r.reply.usage.totalTokens, 0), unknownReservedTokens: calls.filter(r => r.status !== "resolved").reduce((sum, r) => sum + r.reservedTokens, 0), simulations: runs.reduce((sum, r) => sum + r.attempts * r.dayCount, 0) }];
  }));
}

export function auditContinuation(directory: string, options: { confirmedComplete: boolean; output: string; recovered: { v1: string; old3: string; v2: string }; bundle: string }) {
  assert.equal(options.confirmedComplete, true, "Wait for parent confirmation that continuation is complete");
  const root = resolve(directory), result = json(join(root, "continuation-results.json")), manifest = json(join(root, "continuation-manifest.json"));
  assert.equal(result.completed, true, "An incomplete continuation cannot establish a paired winner");
  assert.equal(result.terminalReason, null); assert.equal(result.all20Completed, false); assert.equal(result.primaryFactoryCount, 19);
  assert.equal(result.excludedFactory, EXCLUDED); assert.equal(manifest.excludedCase, EXCLUDED); assert.equal(manifest.unknownRequest, UNKNOWN);
  assert.equal(manifest.approvedContinuation, true); assert.equal(manifest.originalCaseOrderPreserved, true);
  assert.match(manifest.disclosure, /partial final metrics were examined/); assert.match(manifest.disclosure, /not a fresh benchmark rerun/);
  assert.equal(result.disclosure, manifest.disclosure);
  const origin = join(root, "origin"), engine = join(root, "engine");
  eq(tree(origin), manifest.originHashes, "Immutable original evidence snapshot");
  eq(tree(manifest.originalDirectory), manifest.originHashes, "Original failed run was not modified");
  for (const [path, digest] of Object.entries(manifest.sourceHashes)) assert.equal(hash(path), digest, `Frozen continuation source ${path}`);
  const originalPlan = json(join(origin, "evaluation-plan.json")), plan = json(join(engine, "evaluation-plan.json"));
  const original = json(join(origin, "checkpoint.json")), checkpoint = json(join(engine, "checkpoint.json"));
  const failed = json(join(origin, "metrics.json"));
  assert.equal(failed.completed, false); assert.equal(failed.terminalReason, "provider_failure_charge_unknown");
  assert.equal(original.terminalReason, failed.terminalReason); assert.equal(contentHash(originalPlan), manifest.originalPlanHash);
  assert.equal(contentHash(plan), manifest.enginePlanHash);
  const { continuation, outputDirectory, maxTokensPerArm, ...corePlan } = plan;
  eq(corePlan, Object.fromEntries(Object.entries(originalPlan).filter(([key]) => !["outputDirectory", "maxTokensPerArm"].includes(key))), "Core policy, ordering and deadline remain unchanged");
  assert.equal(maxTokensPerArm, manifest.activeTokensPerArm, "Uniform remaining token ceiling is declared");
  assert.equal(continuation.originalPlanHash, manifest.originalPlanHash); assert.equal(continuation.excludedCase, EXCLUDED);
  assert.equal(outputDirectory, engine); assert.equal(originalPlan.factoryLimit, 20); assert.equal(plan.factoryLimit, 20);
  assert.equal(checkpoint.startedAt, original.startedAt); assert.equal(manifest.originalStartedAt, original.startedAt);
  assert.equal(manifest.originalDeadline, original.startedAt + originalPlan.maxRuntimeMs);
  assert.equal(originalPlan.maxRuntimeMs, 30 * 60_000, "Original thirty-minute clock is preserved");
  assert.equal(result.originalStartedAt, original.startedAt); assert.equal(result.originalDeadline, manifest.originalDeadline);
  assert.ok(Date.parse(manifest.createdAt) < manifest.originalDeadline, "Continuation was declared inside original deadline");
  const originalSelection = json(join(origin, "selection.json"));
  eq(json(join(engine, "selection.json")), originalSelection, "Engine keeps original twenty positions");
  eq(manifest.includedIds, originalSelection.ids.filter((id: string) => id !== EXCLUDED), "Exclusion is exactly the interrupted factory");
  assert.equal(manifest.includedIds.length, 19);

  const originalRequests = receipts(join(origin, "requests")), activeRequests = receipts(join(engine, "requests"));
  const originalSimulations = receipts(join(origin, "simulations")), activeSimulations = receipts(join(engine, "simulations"));
  const unresolved = originalRequests.filter(r => r.status !== "resolved" || r.error);
  assert.equal(unresolved.length, 1); const unknown = unresolved[0];
  assert.equal(unknown.id, UNKNOWN); assert.equal(unknown.status, "unknown"); assert.equal(unknown.error, "provider_failure_charge_unknown");
  assert.equal(unknown.caseId, EXCLUDED); assert.equal(unknown.arm, "factory-optimizer-v1"); assert.equal(unknown.round, 1);
  assert.equal(originalRequests.filter(r => r.status === "resolved").length, 93, "Original ninety-three successful calls remain counted");
  const abandoned = originalRequests.filter(excluded), overhead = originalSimulations.filter(retired);
  const tokenDebits = ARMS.slice(0, 4).map(arm => abandoned.filter(r => r.arm === arm).reduce((sum, r) => sum + (r.status === "resolved" ? r.reply.usage.totalTokens : r.reservedTokens), 0));
  assert.equal(maxTokensPerArm, originalPlan.maxTokensPerArm - Math.max(...tokenDebits), "Each model gets the same conservative ceiling after abandoned work");
  eq(manifest.abandonedRequestIds.sort(), abandoned.map(r => r.id).sort(), "Every excluded request is debited");
  eq(manifest.retiredSimulationIds.sort(), overhead.map(r => r.id).sort(), "Every discarded final/excluded simulation is retained as overhead");
  const activeById = new Map(activeRequests.map(r => [r.id, r])), originalById = new Map(originalRequests.map(r => [r.id, r]));
  for (const receipt of originalRequests.filter(r => !excluded(r))) eq(activeById.get(receipt.id), receipt, "Successful included request is reused unchanged");
  for (const receipt of activeRequests) { assert.equal(excluded(receipt), false, "Excluded factory and unknown call are never retried"); assert.equal(receipt.status, "resolved"); assert.ok(!receipt.error); }
  const activeSimulationById = new Map(activeSimulations.map(r => [r.id, r]));
  for (const receipt of originalSimulations.filter(r => !retired(r))) eq(activeSimulationById.get(receipt.id), receipt, "Valid prior feedback simulation is reused unchanged");
  assert.ok(activeSimulations.every(r => !excluded(r)));
  const combinedRequests = [...activeRequests, ...abandoned];
  assert.equal(new Set(combinedRequests.map(r => r.id)).size, combinedRequests.length, "Combined request union has no duplicate dispatch");
  const originalExcludedStates = original.states.filter((s: any) => s.caseId === EXCLUDED);
  const accounting = { original: budgets(originalRequests, originalSimulations), active: budgets(activeRequests, activeSimulations), abandonedAndAuditOverhead: budgets(abandoned, overhead), combined: budgets(combinedRequests, [...activeSimulations, ...overhead]), originalResolvedRequests: 93, originalUnknownRequests: 1, combinedModelCalls: combinedRequests.length, originalCaps: manifest.originalCaps, abandonedPlanning: { simulations: originalExcludedStates.reduce((sum: number, s: any) => sum + (s.teacher?.feedbackSimulationCalls ?? 0), 0), elapsedMs: originalExcludedStates.reduce((sum: number, s: any) => sum + (s.teacherMs ?? 0), 0) } };
  eq(accounting, result.accounting, "All original, active, retired and combined resource accounting");
  eq(manifest.abandonedBudget, accounting.abandonedAndAuditOverhead, "Prepared abandoned-work debit matches final accounting");
  eq(manifest.originalCaps, { calls: originalPlan.maxModelCalls, tokensPerArm: originalPlan.maxTokensPerArm, activeSimulationsPerArm: originalPlan.maxSimulationsPerArm }, "Original request/token caps preserved");
  assert.ok(accounting.combinedModelCalls <= originalPlan.maxModelCalls);
  for (const arm of ARMS) {
    const combined = accounting.combined[arm], active = accounting.active[arm];
    assert.ok(combined.knownTokens + combined.unknownReservedTokens <= originalPlan.maxTokensPerArm);
    assert.ok(active.simulations <= originalPlan.maxSimulationsPerArm, "Active simulator cap; retired CPU work is separately counted");
  }
  for (const request of activeRequests.filter(r => !originalById.has(r.id))) {
    assert.ok(request.startedAt >= Date.parse(manifest.createdAt));
    assert.ok(request.startedAt < manifest.originalDeadline, "No new dispatch after the original deadline");
  }
  const healthFiles = readdirSync(root).filter(name => /^health-\d+\.json$/.test(name));
  assert.ok(healthFiles.length > 0, "Continuation rechecked actual server health");
  for (const file of healthFiles) { const receipt = json(join(root, file)); eq(receipt.health, originalPlan.provenance, "No model/adapter change after partial results"); assert.equal(receipt.planHash, manifest.enginePlanHash); }

  const originalEvents = lines(join(origin, "events.jsonl")).filter(event => {
    if (event.type === "all-searches-ended") return false;
    if (event.caseId === EXCLUDED) return false;
    if (event.id && originalById.has(event.id)) return !excluded(originalById.get(event.id));
    return true;
  });
  const primary = auditV2Results(engine, { confirmedComplete: true, recovered: options.recovered, bundle: options.bundle, continuation: { includedIds: manifest.includedIds, excludedIds: [EXCLUDED], originalEvents, primaryOverall: result.overall } });
  eq(result.cases, checkpoint.states.filter((state: any) => state.caseId !== EXCLUDED), "Primary output contains exactly nineteen complete factory states");

  // The interrupted factory is re-scored solely for an explicitly ineligible
  // display. Its unequally progressed arms never enter paired headline metrics.
  const test = lines(join(plan.dataDirectory, "test-factories.jsonl")).find(c => c.id === EXCLUDED);
  assert.ok(test); const abandonedStates = original.states.filter((state: any) => state.caseId === EXCLUDED);
  assert.equal(abandonedStates.length, ARMS.length); const partial: any[] = [];
  for (const state of abandonedStates) {
    const current = checkpoint.states.find((s: any) => s.caseId === EXCLUDED && s.arm === state.arm);
    eq(current, { ...state, stopped: true, continuationExcluded: true }, "Excluded engine position never evolves");
    const snapshots: any = {};
    for (const [name, layout] of Object.entries({ initial: test.initial, round3: state.snapshot3, round12: state.layout })) {
      eq(validateForTask(layout as any, test.task), [], "Legal excluded retained layout");
      const runs = test.finalDays.map((day: any) => simulate(layout as any, makeScenario(day.seed, day.profile, day.count)));
      const dod = evaluateDoD(DEFAULT_DOD, runs), measured = state.final[name];
      eq(measured.days, runs.map((run: any) => ({ seed: run.scenario.seed, profile: run.scenario.profile, metrics: run.metrics })), "Excluded display trace metrics re-scored independently");
      assert.equal(measured.goalMet, dod.passed); eq(measured.checks, dod.checks, "Excluded DoD checks");
      const objective = mean(runs.map((run: any) => run.metrics.objective)); assert.equal(objective, measured.objective);
      snapshots[name] = { objective, meanDamagePerDay: mean(runs.map((run: any) => run.metrics.damaged)), meanMakespan: mean(runs.map((run: any) => run.metrics.makespan)), zeroDamage: runs.every((run: any) => run.metrics.damaged === 0), fullGoal: dod.passed };
    }
    partial.push({ arm: state.arm, proposalsBeforeInterruption: state.nextRound, acceptedMoves: state.accepted, invalidActions: state.invalid, snapshots });
  }
  eq(result.all20, [...result.cases.map((s: any) => ({ ...s, status: "included" })), ...abandonedStates.map((s: any) => ({ ...s, status: "excluded-infrastructure-interruption", primaryEligible: false }))], "All-twenty display labels the interrupted factory ineligible");
  eq(tree(origin), manifest.originHashes, "Origin remains immutable through audit");
  const audit = { status: "passed", createdAt: new Date().toISOString(), scope: "Nineteen paired factories after explicitly approved infrastructure-only continuation; original interrupted twenty-case experiment remains incomplete.", primaryFactoryCount: 19, sealedPopulation: 20, all20Completed: false, excludedFactory: EXCLUDED, excludedFactoryReason: "Only original unresolved request; network failure with uncertain completion, never retried.", partialFinalResultsWereVisibleBeforeContinuation: true, noModelPromptDataGraderOrDeadlineChanges: true, originalCaseOrderPreserved: true, originalDeadline: manifest.originalDeadline, accounting, primary, excludedPartialDisplay: { primaryEligible: false, notAnEqualBudgetComparison: true, unknownRequest: { id: unknown.id, reservedTokens: unknown.reservedTokens, outputKnown: false }, arms: partial }, limitations: [manifest.disclosure, "Single-seed independently retrained artifacts; archived epoch-one weights differ from the fresh three-epoch run's epoch-one weights, so epoch count is not a perfectly isolated causal factor.", "Active simulator cap is separate from already incurred retired CPU simulations; combined total includes both.", primary.orderingEvidence.limitation], manifestHash: hash(join(root, "continuation-manifest.json")), resultsHash: hash(join(root, "continuation-results.json")) };
  assert.ok(!existsSync(options.output), "Never overwrite prior audit evidence"); writeFileSync(options.output, JSON.stringify(audit, null, 2) + "\n", { flag: "wx" });
  return audit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), confirmedComplete = args.shift() === "--confirmed-complete", directory = args.shift(), output = args.shift();
  assert.ok(directory && output, "Usage: --confirmed-complete CONTINUATION_DIR OUTPUT --v1 DIR --old3 DIR --v2 DIR --bundle DIR");
  const values = new Map<string, string>();
  while (args.length) { const name = args.shift()!, value = args.shift(); assert.ok(["--v1", "--old3", "--v2", "--bundle"].includes(name) && value && !values.has(name)); values.set(name, value); }
  const audit = auditContinuation(directory, { confirmedComplete, output, recovered: { v1: values.get("--v1")!, old3: values.get("--old3")!, v2: values.get("--v2")! }, bundle: values.get("--bundle")! });
  console.log(JSON.stringify({ status: audit.status, output, primaryFactoryCount: 19, all20Completed: false, excludedFactory: EXCLUDED, combinedModelCalls: audit.accounting.combinedModelCalls, detail: audit.primary.detail }, null, 2));
}
