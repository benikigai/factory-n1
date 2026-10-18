import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { contentHash } from "./generate.ts";
import { optimizerTokenReservation } from "./optimizer-evaluate.ts";
import { assertV2Plan, readV2Cases, runV2Evaluation, summarizeV2, validateV2Health, V2_MODELS, type V2Call, type V2Dependencies, type V2Health, type V2Plan } from "./optimizer-v2-evaluate.ts";

export const EXCLUDED_CASE = "optimizer-v2-test-building-11";
export const UNKNOWN_REQUEST = `${EXCLUDED_CASE}-factory-optimizer-v1-1`;
const WRAPPER_FILES = ["src/training/optimizer-v2-continuation.ts", "scripts/continue-optimizer-v2.ts"];
const DISCLOSURE = "Infrastructure-only continuation after partial final metrics were examined. Same model weights, prompts, data, grader, original case positions and proposal ceilings. Any approved interruption pause and active-runtime deadline are recorded explicitly. Factory 11 is excluded from every headline arm; its prior results and uncertain request are retained as abandoned work. This is not a fresh benchmark rerun.";
const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const digest = (path: string) => contentHash(readFileSync(path, "utf8"));
const receipts = (directory: string): any[] => existsSync(directory) ? readdirSync(directory).filter(p => p.endsWith(".json")).map(p => read(join(directory, p))) : [];
const tokenDebit = (receipt: any): number => receipt.status === "resolved" ? receipt.reply.usage.totalTokens : receipt.reservedTokens;
const finalReceipt = (receipt: any) => /-final-(initial|three|twelve)$/.test(receipt.id);
const excludedReceipt = (receipt: any) => receipt.caseId === EXCLUDED_CASE || receipt.id.startsWith(`${EXCLUDED_CASE}-`);
function treeHashes(directory: string, prefix = ""): Record<string, string> {
  return Object.assign({}, ...readdirSync(join(directory, prefix), { withFileTypes: true }).map(entry => {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Evidence snapshot cannot contain symbolic links");
    return entry.isDirectory() ? treeHashes(directory, path) : { [path]: digest(join(directory, path)) };
  }));
}
function budgetRows(requests: any[], simulations: any[]) {
  return Object.fromEntries([...V2_MODELS, "random", "geometric-teacher"].map(arm => {
    const calls = requests.filter(r => r.arm === arm);
    return [arm, { modelCalls: calls.length, knownTokens: calls.filter(r => r.status === "resolved").reduce((sum, r) => sum + tokenDebit(r), 0), unknownReservedTokens: calls.filter(r => r.status !== "resolved").reduce((sum, r) => sum + tokenDebit(r), 0), simulations: simulations.filter(r => r.arm === arm).reduce((sum, r) => sum + r.attempts * r.dayCount, 0) }];
  }));
}
export function prepareV2Continuation(options: { originalDirectory: string; outputDirectory: string; approveContinuation: boolean; now?: number; pauseAllowance?: { activeElapsedMs: number; hardDeadline: number } }) {
  if (!options.approveContinuation) throw new Error("Explicit --approve-continuation is required");
  const originalDirectory = resolve(options.originalDirectory), outputDirectory = resolve(options.outputDirectory);
  if (!outputDirectory.startsWith(`${resolve("runs/optimizer-eval")}/`) || existsSync(outputDirectory) || outputDirectory.startsWith(originalDirectory + "/")) throw new Error("Continuation needs a new sibling output directory inside runs/optimizer-eval");
  const originalPlan = read(join(originalDirectory, "evaluation-plan.json")) as V2Plan;
  if (originalPlan.outputDirectory !== originalDirectory) throw new Error("Original evidence directory mismatch");
  assertV2Plan(originalPlan);
  if (!existsSync(join(originalDirectory, "selection.json"))) throw new Error("Original frozen selection is missing");
  const cases = readV2Cases(originalPlan), checkpoint = read(join(originalDirectory, "checkpoint.json"));
  const requests = receipts(join(originalDirectory, "requests")), simulations = receipts(join(originalDirectory, "simulations"));
  const unresolved = requests.filter(r => r.status !== "resolved" || r.error);
  if (unresolved.length !== 1 || unresolved[0].id !== UNKNOWN_REQUEST || unresolved[0].caseId !== EXCLUDED_CASE || unresolved[0].arm !== "factory-optimizer-v1" || unresolved[0].round !== 1 || unresolved[0].status !== "unknown" || unresolved[0].error !== "provider_failure_charge_unknown" || checkpoint.terminalReason !== "provider_failure_charge_unknown") throw new Error("Only the documented factory-11 network failure can be continued");
  if (checkpoint.planHash !== contentHash(originalPlan) || checkpoint.casesHash !== contentHash(cases) || !cases.some(c => c.id === EXCLUDED_CASE)) throw new Error("Original checkpoint identity mismatch");
  const now = options.now ?? Date.now(), originalStartedAt = checkpoint.startedAt;
  const deadline = originalStartedAt + originalPlan.maxRuntimeMs;
  let effectiveDeadline = deadline, pause: any = null;
  if (options.pauseAllowance) {
    const { activeElapsedMs, hardDeadline } = options.pauseAllowance;
    if (!Number.isSafeInteger(activeElapsedMs) || activeElapsedMs < 0 || activeElapsedMs >= originalPlan.maxRuntimeMs || !Number.isSafeInteger(hardDeadline) || hardDeadline > Date.parse("2026-10-18T00:08:52.000Z") || now < originalStartedAt + activeElapsedMs) throw new Error("Invalid approved pause allowance");
    effectiveDeadline = Math.min(now + originalPlan.maxRuntimeMs - activeElapsedMs, hardDeadline);
    pause = { userApproved: true, reason: "User approved continuing 19 valid pairs; exclude human approval and same-VM restart pause, retaining 30-minute active evaluation and original VM workstop", originalActiveElapsedMs: activeElapsedMs, pausedMs: now - (originalStartedAt + activeElapsedMs), effectiveAddedMs: effectiveDeadline - deadline, resumedAt: now, hardDeadline };
    checkpoint.startedAt = effectiveDeadline - originalPlan.maxRuntimeMs;
  }
  if (now >= effectiveDeadline) throw new Error("Original evaluation deadline has expired");
  const originHashes = treeHashes(originalDirectory), sourceHashes = Object.fromEntries(WRAPPER_FILES.map(path => [path, digest(path)]));
  const abandonedRequests = requests.filter(excludedReceipt), retiredSimulations = simulations.filter(r => excludedReceipt(r) || finalReceipt(r));
  const largestAbandonedTokenDebit = Math.max(...V2_MODELS.map(arm => abandonedRequests.filter(r => r.arm === arm).reduce((sum, r) => sum + tokenDebit(r), 0)));
  if (largestAbandonedTokenDebit >= originalPlan.maxTokensPerArm) throw new Error("Original token budget is exhausted");
  const engine = join(outputDirectory, "engine"), origin = join(outputDirectory, "origin");
  mkdirSync(outputDirectory, { recursive: true }); cpSync(originalDirectory, origin, { recursive: true, errorOnExist: true });
  if (!isDeepStrictEqual(treeHashes(origin), originHashes) || !isDeepStrictEqual(treeHashes(originalDirectory), originHashes)) throw new Error("Original evidence changed while cloning");
  mkdirSync(join(engine, "requests"), { recursive: true }); mkdirSync(join(engine, "simulations"));
  const plan = { ...originalPlan, outputDirectory: engine, maxTokensPerArm: originalPlan.maxTokensPerArm - largestAbandonedTokenDebit, continuation: { originalPlanHash: contentHash(originalPlan), excludedCase: EXCLUDED_CASE, disclosure: DISCLOSURE, internalDenominator: "20 original positions retained solely to preserve arm order and seeded random moves; use continuation-results.json for reporting" } };
  write(join(engine, "evaluation-plan.json"), plan);
  write(join(engine, "selection.json"), read(join(origin, "selection.json")));
  const healthReceipt = read(join(origin, "health-receipt.json"));
  write(join(engine, "health-receipt.json"), { ...healthReceipt, planHash: contentHash(plan), inheritedOnly: true });
  for (const receipt of requests.filter(r => !excludedReceipt(r))) write(join(engine, "requests", receipt.id + ".json"), receipt);
  for (const receipt of simulations.filter(r => !excludedReceipt(r) && !finalReceipt(r))) write(join(engine, "simulations", receipt.id + ".json"), receipt);
  for (const state of checkpoint.states) {
    if (state.caseId === EXCLUDED_CASE) {
      if (!state.final) throw new Error("Excluded states require the original archived final snapshot");
      state.stopped = true;
      state.continuationExcluded = true;
    } else {
      delete state.final;
      if (state.nextRound < 3 && !state.stopped) delete state.snapshot3;
    }
  }
  checkpoint.planHash = contentHash(plan); checkpoint.searchFinished = false; checkpoint.terminalReason = null;
  write(join(engine, "checkpoint.json"), checkpoint);
  const manifest = { schemaVersion: 1, disclosure: DISCLOSURE, approvedContinuation: true, createdAt: new Date(options.now ?? Date.now()).toISOString(), originalDirectory, outputDirectory, originalPlanHash: contentHash(originalPlan), enginePlanHash: contentHash(plan), originHashes, sourceHashes, excludedCase: EXCLUDED_CASE, unknownRequest: UNKNOWN_REQUEST, includedIds: cases.filter(c => c.id !== EXCLUDED_CASE).map(c => c.id), originalStartedAt, originalDeadline: deadline, effectiveDeadline, engineStartedAt: checkpoint.startedAt, pause, abandonedRequestIds: abandonedRequests.map(r => r.id), retiredSimulationIds: retiredSimulations.map(r => r.id), abandonedBudget: budgetRows(abandonedRequests, retiredSimulations), originalCaps: { calls: originalPlan.maxModelCalls, tokensPerArm: originalPlan.maxTokensPerArm, activeSimulationsPerArm: originalPlan.maxSimulationsPerArm }, originalCaseOrderPreserved: true, activeTokensPerArm: plan.maxTokensPerArm, tokenPolicy: "All included arms receive the same conservative remaining token ceiling after subtracting the largest excluded-arm debit", snapshotPolicy: "Included final snapshots retired and recomputed after searches. Incomplete pre-round-3 snapshots cleared. Excluded old finals retained only to skip all further work; never included in headline metrics." };
  write(join(outputDirectory, "continuation-manifest.json"), manifest);
  return manifest;
}

export async function runV2Continuation(outputDirectory: string, approveContinuation: boolean, health: V2Health, call: V2Call, dependencies: V2Dependencies = {}) {
  if (!approveContinuation) throw new Error("Explicit --approve-continuation is required");
  const root = resolve(outputDirectory), manifest = read(join(root, "continuation-manifest.json")), origin = join(root, "origin"), engine = join(root, "engine");
  if (!isDeepStrictEqual(treeHashes(origin), manifest.originHashes) || !isDeepStrictEqual(Object.fromEntries(WRAPPER_FILES.map(path => [path, digest(path)])), manifest.sourceHashes)) throw new Error("Continuation evidence or wrapper source changed");
  const plan = read(join(engine, "evaluation-plan.json")) as V2Plan;
  if (contentHash(plan) !== manifest.enginePlanHash) throw new Error("Continuation plan changed");
  assertV2Plan(plan); validateV2Health(health, plan.provenance!);
  const healthPath = join(root, `health-${Date.now()}.json`);
  write(healthPath, { checkedAt: new Date().toISOString(), health, planHash: contentHash(plan) });
  const cases = readV2Cases(plan);
  const excludedRequests = receipts(join(origin, "requests")).filter(excludedReceipt);
  const originalPlan = read(join(origin, "evaluation-plan.json")) as V2Plan;
  const guarded: V2Call = async request => {
    const active = receipts(join(engine, "requests")), combined = [...active, ...excludedRequests];
    const pending = active.filter(r => r.status === "pending");
    if (pending.length !== 1 || pending[0].caseId === EXCLUDED_CASE) throw new Error("Unexpected pending request");
    const reservation = optimizerTokenReservation(request.messages, 128);
    if (pending[0].reservedTokens !== reservation || pending[0].requestHash !== contentHash({ model: request.model, messages: request.messages, temperature: 0, maxOutputTokens: 128 })) throw new Error("Dispatch differs from its durable receipt");
    if (combined.length > originalPlan.maxModelCalls || combined.filter(r => r.arm === request.model).reduce((sum, r) => sum + tokenDebit(r), 0) > originalPlan.maxTokensPerArm || (dependencies.now?.() ?? Date.now()) >= (manifest.effectiveDeadline ?? manifest.originalDeadline)) throw new Error("Combined original budget exhausted");
    return call(request);
  };
  const raw = await runV2Evaluation(plan, cases, guarded, dependencies);
  if (!raw.internalOnly) writeFileSync(join(engine, "metrics.json"), JSON.stringify({ ...raw, internalOnly: true, internalSearchCompleted: raw.completed, completed: false, scope: "Internal engine positions only: one factory was deliberately skipped. Use ../continuation-results.json for the 19-factory comparison." }, null, 2) + "\n", { mode: 0o600 });
  const activeRequests = receipts(join(engine, "requests")), activeSimulations = receipts(join(engine, "simulations"));
  const originalRequests = receipts(join(origin, "requests")), originalSimulations = receipts(join(origin, "simulations"));
  const retiredSimulations = originalSimulations.filter(r => excludedReceipt(r) || finalReceipt(r));
  const includedStates = raw.cases.filter((s: any) => s.caseId !== EXCLUDED_CASE);
  const originalStates = read(join(origin, "checkpoint.json")).states.filter((s: any) => s.caseId === EXCLUDED_CASE);
  const result = { schemaVersion: 1, disclosure: DISCLOSURE, completed: (raw.internalSearchCompleted ?? raw.completed) && includedStates.every((s: any) => s.stopped || s.nextRound >= 12), terminalReason: raw.terminalReason, primaryFactoryCount: manifest.includedIds.length, all20Completed: false, excludedFactory: EXCLUDED_CASE, originalDeadline: manifest.originalDeadline, effectiveDeadline: manifest.effectiveDeadline ?? manifest.originalDeadline, pause: manifest.pause, originalStartedAt: manifest.originalStartedAt, overall: summarizeV2({ ...read(join(engine, "checkpoint.json")), states: includedStates }, activeRequests, activeSimulations, manifest.includedIds.length), cases: includedStates, all20: [...includedStates.map((s: any) => ({ ...s, status: "included" })), ...originalStates.map((s: any) => ({ ...s, status: "excluded-infrastructure-interruption", primaryEligible: false }))], accounting: { original: budgetRows(originalRequests, originalSimulations), active: budgetRows(activeRequests, activeSimulations), abandonedAndAuditOverhead: budgetRows(excludedRequests, retiredSimulations), combined: budgetRows([...activeRequests, ...excludedRequests], [...activeSimulations, ...retiredSimulations]), originalResolvedRequests: originalRequests.filter(r => r.status === "resolved").length, originalUnknownRequests: originalRequests.filter(r => r.status !== "resolved").length, combinedModelCalls: activeRequests.length + excludedRequests.length, originalCaps: manifest.originalCaps, abandonedPlanning: { simulations: originalStates.reduce((sum: number, s: any) => sum + (s.teacher?.feedbackSimulationCalls ?? 0), 0), elapsedMs: originalStates.reduce((sum: number, s: any) => sum + (s.teacherMs ?? 0), 0) } }, engineMetrics: "engine/metrics.json has 20 internal positions and is not a headline comparison; this file removes the interrupted factory from all six arms" };
  const resultPath = join(root, "continuation-results.json");
  if (!existsSync(resultPath)) write(resultPath, result);
  return result;
}
