import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { graderHash } from "../sim/version.ts";
import { SPLITS } from "../sim/scenarios.ts";
import type { Layout } from "../sim/types.ts";
import { validateForTask } from "../tasks/task.ts";
import type { DemandDay } from "./critic.ts";
import { buildingHash, contentHash, layoutHash } from "./generate.ts";
import { legalMoveActions, type OptimizerCase } from "./optimizer-data.ts";
import { applyAction, betterCandidate, measureLayout, optimizerMessages, parseAction, OPTIMIZER_PROMPT_PROFILE, type OptimizerAction, type OptimizerAttempt, type OptimizerMeasurement } from "./optimizer.ts";

export type OptimizerArm = "base" | "tuned" | "random";
export interface OptimizerProvenance {
  baseModel: string;
  tunedModel: string;
  baseCheckpoint: string;
  tunedBaseCheckpoint: string;
  trainingJobId: string;
  taskProfile: "optimizer";
  promptProfile: "nemotron8b-thinking-off-v1";
  dataset: { graderHash: string; files: { "train.jsonl": string; "validation.jsonl": string } };
  adapterHashes: { "adapter_config.json": string; "adapter_model.safetensors": string };
}
export interface OptimizerEvaluationOptions {
  dataDirectory: string;
  outputDirectory: string;
  baseModel: string;
  tunedModel: string;
  baseUrl: string;
  provenance?: OptimizerProvenance;
  live: boolean;
  finalEval: boolean;
  factoryLimit: number;
  proposalsPerFactory: 3;
  maxModelCalls: number;
  maxTokensPerArm: number;
  maxSimulationsPerArm: number;
  maxOutputTokens: 128;
  randomSeed: number;
}
export interface OptimizerReply {
  content: string | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string | null;
  responseId?: string;
}
export type OptimizerCall = (request: { model: string; messages: ReturnType<typeof optimizerMessages>; temperature: 0; maxOutputTokens: number }) => Promise<OptimizerReply>;
const ARMS: OptimizerArm[] = ["base", "tuned", "random"];
const SOURCE_FILES = ["src/training/generate.ts", "src/tasks/task.ts", "src/training/optimizer.ts", "src/training/optimizer-data.ts", "src/training/optimizer-evaluate.ts", "scripts/evaluate-optimizer.ts"];
const SHA256 = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown) => contentHash(a) === contentHash(b);
const sourceHashes = () => Object.fromEntries(SOURCE_FILES.map(path => [path, contentHash(readFileSync(path, "utf8"))]));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });

function validateOptions(options: OptimizerEvaluationOptions) {
  if (!options.finalEval) throw new Error("Fresh-factory test access requires --final-eval after training and model selection are frozen");
  if (!options.baseModel || !options.tunedModel || options.baseModel === options.tunedModel) throw new Error("Use distinct base and tuned model aliases");
  for (const key of ["factoryLimit", "maxModelCalls", "maxTokensPerArm", "maxSimulationsPerArm", "randomSeed"] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (options.factoryLimit > 20 || options.proposalsPerFactory !== 3 || options.maxOutputTokens !== 128 || options.maxModelCalls > 120) throw new Error("Pilot limits are 20 factories, 3 proposals per arm, 128 output tokens and 120 model calls");
  const endpoint = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Use an HTTP endpoint without embedded credentials");
  if (options.live) {
    const proof = options.provenance;
    if (!proof || proof.baseModel !== options.baseModel || proof.tunedModel !== options.tunedModel || proof.baseCheckpoint !== proof.tunedBaseCheckpoint || !/@[a-f0-9]{40}$/.test(proof.baseCheckpoint) || !proof.trainingJobId || proof.taskProfile !== "optimizer" || proof.promptProfile !== "nemotron8b-thinking-off-v1") throw new Error("Live comparison requires the optimizer adapter and matching immutable base checkpoint, job and prompt profile");
    if (!proof.dataset || !SHA256.test(proof.dataset.graderHash) || ![proof.dataset.files?.["train.jsonl"], proof.dataset.files?.["validation.jsonl"], proof.adapterHashes?.["adapter_config.json"], proof.adapterHashes?.["adapter_model.safetensors"]].every(value => typeof value === "string" && SHA256.test(value))) throw new Error("Live comparison requires training dataset and adapter content hashes");
  }
}

/** Freeze without reading any held-out factory or final demand day. */
export function freezeOptimizerEvaluation(options: OptimizerEvaluationOptions) {
  validateOptions(options);
  const outputDirectory = resolve(options.outputDirectory), dataDirectory = resolve(options.dataDirectory);
  if (!outputDirectory.startsWith(`${resolve("runs/optimizer-eval")}/`) || existsSync(outputDirectory)) throw new Error("Use a new output directory inside runs/optimizer-eval/");
  const manifestBytes = readFileSync(join(dataDirectory, "manifest.json"), "utf8"), manifest = JSON.parse(manifestBytes);
  const file = manifest.files?.["test-factories.jsonl"];
  if (manifest.schemaVersion !== 1 || !file || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || manifest.graderHash !== graderHash()) throw new Error("Dataset manifest or unchanged grader hash is invalid");
  if (manifest.taskProfile !== "optimizer" || manifest.promptProfile !== OPTIMIZER_PROMPT_PROFILE || manifest.sourceHashes?.["src/training/optimizer.ts"] !== contentHash(readFileSync("src/training/optimizer.ts", "utf8"))) throw new Error("Optimizer prompt or acceptance rules differ from the training dataset");
  if (options.live && (options.provenance!.dataset.graderHash !== manifest.graderHash || ["train.jsonl", "validation.jsonl"].some(name => options.provenance!.dataset.files[name as "train.jsonl"] !== manifest.files?.[name]?.sha256))) throw new Error("Adapter was not trained on this frozen optimizer dataset");
  const plan = {
    schemaVersion: 1, ...options, outputDirectory, dataDirectory, createdAt: new Date().toISOString(),
    manifestHash: contentHash(manifestBytes), datasetFile: "test-factories.jsonl", datasetHash: file.sha256 as string, datasetBytes: file.bytes as number,
    graderHash: manifest.graderHash as string, sourceHashes: sourceHashes(), temperature: 0, automaticRetries: 0,
    scope: "Three move proposals on fresh synthetic factories; the unchanged simulator scores retained layouts. This is not a claim about real factory performance.",
    selection: "First factoryLimit cases sorted by stable case ID; no score-based selection",
    acceptance: "Same betterCandidate function as training; only feedback demand affects acceptance. All final demand stays hidden until every search arm ends.",
    randomBaseline: "One deterministic legal move sampled without candidate scoring per opportunity; same simulator acceptance rule and three opportunities",
  };
  mkdirSync(outputDirectory, { recursive: true });
  write(join(outputDirectory, "evaluation-plan.json"), plan);
  return plan;
}
export type OptimizerEvaluationPlan = ReturnType<typeof freezeOptimizerEvaluation>;

function assertFrozen(plan: OptimizerEvaluationPlan) {
  validateOptions(plan);
  if (!same(JSON.parse(readFileSync(join(plan.outputDirectory, "evaluation-plan.json"), "utf8")), plan)) throw new Error("Frozen evaluation plan changed");
  if (contentHash(readFileSync(join(plan.dataDirectory, "manifest.json"), "utf8")) !== plan.manifestHash || graderHash() !== plan.graderHash || !same(sourceHashes(), plan.sourceHashes)) throw new Error("Frozen manifest, grader or prompt/evaluator source changed");
}

export function validateOptimizerHealth(value: unknown, proof: OptimizerProvenance | undefined) {
  if (!proof || !object(value) || value.status !== "ready" || value.trainingJobId !== proof.trainingJobId || value.baseCheckpoint !== proof.baseCheckpoint || value.taskProfile !== "optimizer" || value.promptProfile !== proof.promptProfile || !same(value.dataset, proof.dataset) || !same(value.adapterHashes, proof.adapterHashes)) throw new Error("Server health does not match the optimizer job, checkpoint, dataset, adapter and prompt profile");
  return { status: "ready", trainingJobId: proof.trainingJobId, baseCheckpoint: proof.baseCheckpoint, taskProfile: proof.taskProfile, promptProfile: proof.promptProfile, dataset: proof.dataset, adapterHashes: proof.adapterHashes };
}

function validateDays(days: DemandDay[], reserved: Set<number>) {
  if (!Array.isArray(days) || days.length !== 4 || new Set(days.map(day => day.seed)).size !== 4 || days.some(day => !Number.isSafeInteger(day.seed) || reserved.has(day.seed) || day.count !== 100 || !["normal", "peak", "fragile", "skewed"].includes(day.profile)) || new Set(days.map(day => day.profile)).size !== 4) throw new Error("Each demand set must contain four fresh 100-package profiles");
  for (const day of days) reserved.add(day.seed);
}

export function readOptimizerCases(plan: OptimizerEvaluationPlan): OptimizerCase[] {
  assertFrozen(plan);
  if (plan.live) {
    const receipt = JSON.parse(readFileSync(join(plan.outputDirectory, "health-receipt.json"), "utf8"));
    if (receipt.planHash !== contentHash(plan)) throw new Error("Health receipt belongs to another frozen plan");
    validateOptimizerHealth(receipt.health, plan.provenance);
  }
  const bytes = readFileSync(join(plan.dataDirectory, plan.datasetFile));
  if (bytes.length !== plan.datasetBytes || contentHash(bytes.toString("utf8")) !== plan.datasetHash) throw new Error("Held-out factories do not match their frozen hash");
  const manifest = JSON.parse(readFileSync(join(plan.dataDirectory, "manifest.json"), "utf8"));
  const reservedBuildings = new Set<string>([...(manifest.excludedBuildingHashes ?? []), ...(manifest.splitBuildingHashes?.train ?? []), ...(manifest.splitBuildingHashes?.validation ?? [])]);
  const reservedDays = new Set<number>([...Object.values(SPLITS).flat().map(day => day.seed), ...(manifest.splitDemandSeeds?.train ?? []), ...(manifest.splitDemandSeeds?.validation ?? [])]);
  const ids = new Set<string>(), layouts = new Set<string>();
  const cases = bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line) as OptimizerCase).sort((a, b) => a.id.localeCompare(b.id));
  for (const item of cases) {
    if (!item.id || item.split !== "test" || ids.has(item.id) || !item.task || item.buildingHash !== buildingHash(item.task) || reservedBuildings.has(item.buildingHash) || item.initialLayoutHash !== layoutHash(item.initial) || layouts.has(item.initialLayoutHash) || validateForTask(item.initial, item.task).length) throw new Error("Held-out factory is duplicate, overlapping or invalid");
    ids.add(item.id); reservedBuildings.add(item.buildingHash); layouts.add(item.initialLayoutHash);
    validateDays(item.feedbackDays, reservedDays); validateDays(item.finalDays, reservedDays);
  }
  if (cases.length < plan.factoryLimit) throw new Error("Not enough distinct fresh factories for frozen selection");
  const selected = cases.slice(0, plan.factoryLimit);
  write(join(plan.outputDirectory, "selection.json"), { hash: contentHash(selected), cases: selected.map(item => ({ id: item.id, buildingHash: item.buildingHash, initialLayoutHash: item.initialLayoutHash })) });
  return selected;
}

export function optimizerTokenReservation(messages: ReturnType<typeof optimizerMessages>, maxOutputTokens = 128) {
  // UTF-8 byte count bounds text tokenization; the fixed margin covers the shared chat template.
  return Buffer.byteLength(JSON.stringify(messages), "utf8") + 4096 + maxOutputTokens;
}
interface ArmBudget { offeredProposals: number; attemptedProposals: number; modelCalls: number; acceptedMoves: number; invalidActions: number; stops: number; knownTokens: number; reservedUnknownTokens: number; simulations: number; layoutEvaluations: number }
interface ArmState { arm: OptimizerArm; caseId: string; layout: Layout; feedback: OptimizerMeasurement | null; previousAttempts: OptimizerAttempt[]; status: "pending" | "complete" | "stopped" | "interrupted"; attemptedProposals: number; acceptedMoves: number; invalidActions: number; reason: string | null; initialFinal?: OptimizerMeasurement; championFinal?: OptimizerMeasurement }
function emptyBudget(offeredProposals: number): ArmBudget { return { offeredProposals, attemptedProposals: 0, modelCalls: 0, acceptedMoves: 0, invalidActions: 0, stops: 0, knownTokens: 0, reservedUnknownTokens: 0, simulations: 0, layoutEvaluations: 0 }; }
const zeroDamage = (measurement: OptimizerMeasurement) => measurement.valid && measurement.days.length > 0 && measurement.days.every(day => day.metrics.damaged === 0);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function summarizeOptimizerResults(cases: OptimizerCase[], states: ArmState[], budgets: Record<OptimizerArm, ArmBudget>) {
  const byArm = Object.fromEntries(ARMS.map(arm => {
    const rows = states.filter(state => state.arm === arm), scored = rows.filter(state => state.initialFinal && state.championFinal);
    const deltas = scored.filter(row => row.initialFinal!.objective !== null && row.championFinal!.objective !== null).map(row => row.championFinal!.objective! - row.initialFinal!.objective!);
    return [arm, {
      factories: cases.length, completedSearches: rows.filter(row => ["complete", "stopped"].includes(row.status)).length,
      scoredFactories: scored.length, missingScores: cases.length - scored.length,
      initialGoalPasses: scored.filter(row => row.initialFinal!.goalMet).length, finalGoalPasses: scored.filter(row => row.championFinal!.goalMet).length,
      initialZeroDamage: scored.filter(row => zeroDamage(row.initialFinal!)).length, finalZeroDamage: scored.filter(row => zeroDamage(row.championFinal!)).length,
      meanInitialObjective: mean(scored.map(row => row.initialFinal!.objective).filter((value): value is number => value !== null)),
      meanFinalObjective: mean(scored.map(row => row.championFinal!.objective).filter((value): value is number => value !== null)),
      meanObjectiveDelta: mean(deltas), objectiveImprovements: deltas.filter(delta => delta < 0).length,
      budget: { ...budgets[arm], skippedProposals: budgets[arm].offeredProposals - budgets[arm].attemptedProposals },
    }];
  })) as Record<OptimizerArm, { factories: number; completedSearches: number; scoredFactories: number; missingScores: number; initialGoalPasses: number; finalGoalPasses: number; initialZeroDamage: number; finalZeroDamage: number; meanInitialObjective: number | null; meanFinalObjective: number | null; meanObjectiveDelta: number | null; objectiveImprovements: number; budget: ArmBudget & { skippedProposals: number } }>;
  const pairs = cases.map(item => {
    const base = states.find(row => row.caseId === item.id && row.arm === "base")!, tuned = states.find(row => row.caseId === item.id && row.arm === "tuned")!;
    const complete = [base, tuned].every(row => ["complete", "stopped"].includes(row.status) && row.championFinal);
    const a = base.championFinal?.objective, b = tuned.championFinal?.objective;
    return { caseId: item.id, buildingHash: item.buildingHash, complete, baseGoalMet: base.championFinal?.goalMet ?? null, tunedGoalMet: tuned.championFinal?.goalMet ?? null, baseZeroDamage: base.championFinal ? zeroDamage(base.championFinal) : null, tunedZeroDamage: tuned.championFinal ? zeroDamage(tuned.championFinal) : null, tunedMinusBaseObjective: a == null || b == null ? null : b - a };
  });
  return {
    scope: "Measured factory outcomes after three proposal opportunities; schema correctness alone is not an optimization win.",
    definitions: { objectiveDelta: "Final held-out objective minus initial held-out objective; negative is better. pairedWins compares final objective only; goal and zero-damage wins are separate.", denominator: "All selected factories are retained, including malformed outputs, stopped searches and interrupted arms.", goalPass: "The unchanged DoD passes on all four previously unseen final demand days.", fairness: "Equal offered proposal, model output, token and simulator limits; stop and invalid actions may use less than the allowance. Random baseline has no model tokens." },
    overall: byArm, pairedCases: pairs.filter(row => row.complete).length, incompletePairs: pairs.filter(row => !row.complete).length,
    pairedGoalWins: { base: pairs.filter(row => row.complete && row.baseGoalMet && !row.tunedGoalMet).length, tuned: pairs.filter(row => row.complete && row.tunedGoalMet && !row.baseGoalMet).length, ties: pairs.filter(row => row.complete && row.baseGoalMet === row.tunedGoalMet).length },
    pairedZeroDamageWins: { base: pairs.filter(row => row.complete && row.baseZeroDamage && !row.tunedZeroDamage).length, tuned: pairs.filter(row => row.complete && row.tunedZeroDamage && !row.baseZeroDamage).length, ties: pairs.filter(row => row.complete && row.baseZeroDamage === row.tunedZeroDamage).length },
    pairedWins: { base: pairs.filter(row => row.complete && row.tunedMinusBaseObjective !== null && row.tunedMinusBaseObjective > 0).length, tuned: pairs.filter(row => row.complete && row.tunedMinusBaseObjective !== null && row.tunedMinusBaseObjective < 0).length, ties: pairs.filter(row => row.complete && row.tunedMinusBaseObjective === 0).length }, pairs,
  };
}

/** No retries or output repair. Retain the current champion on malformed or illegal proposals. */
export async function runOptimizerEvaluation(plan: OptimizerEvaluationPlan, cases: OptimizerCase[], call: OptimizerCall, measure = measureLayout) {
  if (!plan.live) throw new Error("Model calls require --live");
  assertFrozen(plan);
  if (!same(JSON.parse(readFileSync(join(plan.outputDirectory, "selection.json"), "utf8")).hash, contentHash(cases))) throw new Error("Selected factories changed after freezing");
  validateOptimizerHealth(JSON.parse(readFileSync(join(plan.outputDirectory, "health-receipt.json"), "utf8")).health, plan.provenance);
  const journal = join(plan.outputDirectory, "receipts.jsonl");
  if (existsSync(journal) || existsSync(join(plan.outputDirectory, "metrics.json"))) throw new Error("Evaluation already attempted; no automatic replay");
  const record = (value: unknown) => appendFileSync(journal, JSON.stringify(value) + "\n", { mode: 0o600 });
  const offered = cases.length * plan.proposalsPerFactory;
  const budgets = Object.fromEntries(ARMS.map(arm => [arm, emptyBudget(offered)])) as Record<OptimizerArm, ArmBudget>;
  const states: ArmState[] = cases.flatMap(item => ARMS.map(arm => ({ arm, caseId: item.id, layout: structuredClone(item.initial), feedback: null, previousAttempts: [], status: "pending", attemptedProposals: 0, acceptedMoves: 0, invalidActions: 0, reason: null })));
  let stopped: string | null = null;
  const score = (item: OptimizerCase, state: ArmState, layout: Layout, days: DemandDay[], stage: string) => {
    const budget = budgets[state.arm];
    if (budget.simulations + days.length > plan.maxSimulationsPerArm) throw new Error("simulator_budget_exhausted");
    budget.layoutEvaluations++; budget.simulations += days.length;
    const result = measure(item.task, layout, days);
    record({ type: "simulation", caseId: item.id, arm: state.arm, stage, layoutHash: layoutHash(layout), days, result });
    return result;
  };
  // Preflight permits all offered candidate simulations and both final evaluations, even if stop uses fewer.
  const simulationAllowance = cases.reduce((sum, item) => sum + item.feedbackDays.length * (1 + plan.proposalsPerFactory) + item.finalDays.length * 2, 0);
  if (plan.maxModelCalls < offered * 2 || plan.maxSimulationsPerArm < simulationAllowance) stopped = "frozen_budget_cannot_cover_offered_evaluation";
  search: for (const item of cases) {
    if (stopped) break;
    const pair = states.filter(state => state.caseId === item.id && state.arm !== "random");
    for (const state of pair) state.feedback = score(item, state, state.layout, item.feedbackDays, "initial-feedback");
    for (let round = 0; round < plan.proposalsPerFactory; round++) {
      // Alternate first arm by factory and round to avoid a fixed ordering advantage.
      const order = (cases.indexOf(item) + round) % 2 ? [...pair].reverse() : pair;
      for (const state of order) {
        if (state.status === "stopped") continue;
        const budget = budgets[state.arm], messages = optimizerMessages(item.task, state.layout, state.feedback!, state.previousAttempts);
        const reserve = optimizerTokenReservation(messages, plan.maxOutputTokens);
        if (budgets.base.modelCalls + budgets.tuned.modelCalls >= plan.maxModelCalls || budget.modelCalls >= offered || budget.knownTokens + budget.reservedUnknownTokens + reserve > plan.maxTokensPerArm) { stopped = "model_budget_exhausted_before_dispatch"; break search; }
        budget.modelCalls++; budget.attemptedProposals++; state.attemptedProposals++; budget.reservedUnknownTokens += reserve;
        const model = state.arm === "base" ? plan.baseModel : plan.tunedModel;
        record({ type: "pending", caseId: item.id, arm: state.arm, round, model, messages, promptHash: contentHash(messages), maxOutputTokens: plan.maxOutputTokens, reservedTokens: reserve });
        let reply: OptimizerReply;
        try { reply = await call({ model, messages, temperature: 0, maxOutputTokens: plan.maxOutputTokens }); }
        catch (error) { stopped = "request_failed_charge_unknown"; record({ type: "error", caseId: item.id, arm: state.arm, round, code: stopped, ...(object(error) && Number.isInteger(error.status) ? { status: Number(error.status) } : {}) }); break search; }
        const usage = reply.usage;
        if (!usage || ![usage.promptTokens, usage.completionTokens, usage.totalTokens].every(value => Number.isSafeInteger(value) && value >= 0) || usage.totalTokens !== usage.promptTokens + usage.completionTokens) stopped = "missing_or_invalid_usage_charge_unknown";
        else { budget.reservedUnknownTokens -= reserve; budget.knownTokens += usage.totalTokens; if (usage.totalTokens > reserve || usage.completionTokens > plan.maxOutputTokens) stopped = "provider_exceeded_reserved_token_bound"; }
        record({ type: "response", caseId: item.id, arm: state.arm, round, reply, budget: { ...budget } });
        if (stopped) break search;
        let action: OptimizerAction | undefined, candidate: Layout;
        const remember = (attempt: OptimizerAttempt) => { state.previousAttempts = [...state.previousAttempts.slice(-2), attempt]; };
        try { action = parseAction(reply.content ?? ""); candidate = applyAction(item.task, state.layout, action); }
        catch (error) {
          budget.invalidActions++; state.invalidActions++;
          const attempt: OptimizerAttempt = { ...(action ? { action } : { rawText: (reply.content ?? "").slice(0, 512) }), status: "invalid", reason: error instanceof Error ? error.message.slice(0, 512) : "Invalid action" };
          remember(attempt);
          record({ type: "action", caseId: item.id, arm: state.arm, round, status: "invalid-action", attempt, retainedLayoutHash: layoutHash(state.layout) });
          continue;
        }
        if (action.op === "stop") { state.status = "stopped"; state.reason = "model_stop"; budget.stops++; record({ type: "action", caseId: item.id, arm: state.arm, round, action, status: "stopped" }); continue; }
        const result = score(item, state, candidate, item.feedbackDays, "candidate-feedback");
        const accepted = betterCandidate(state.feedback!, result);
        remember({ action, status: accepted ? "accepted" : "rejected", feedback: result, ...(accepted ? {} : { reason: "Did not reduce the feedback objective while preserving every already-passed check" }) });
        if (accepted) { state.layout = candidate; state.feedback = result; state.acceptedMoves++; budget.acceptedMoves++; }
        record({ type: "action", caseId: item.id, arm: state.arm, round, action, accepted, retainedLayoutHash: layoutHash(state.layout) });
      }
    }
    for (const state of pair) if (state.status === "pending") state.status = "complete";
  }
  for (const state of states) if (state.arm !== "random" && state.status === "pending") { state.status = "interrupted"; state.reason = stopped; }
  // The local baseline samples a legal action without consulting any candidate's score first.
  if (simulationAllowance <= plan.maxSimulationsPerArm) for (const [index, item] of cases.entries()) {
    const state = states.find(row => row.caseId === item.id && row.arm === "random")!, budget = budgets.random;
    state.feedback = score(item, state, state.layout, item.feedbackDays, "initial-feedback");
    for (let round = 0; round < plan.proposalsPerFactory; round++) {
      budget.attemptedProposals++; state.attemptedProposals++;
      const action = legalMoveActions(item.task, state.layout, plan.randomSeed + index * 1009 + round, 1)[0];
      if (!action) { state.status = "stopped"; state.reason = "no_legal_move"; budget.stops++; break; }
      const candidate = applyAction(item.task, state.layout, action), result = score(item, state, candidate, item.feedbackDays, "candidate-feedback");
      const accepted = betterCandidate(state.feedback!, result);
      if (accepted) { state.layout = candidate; state.feedback = result; state.acceptedMoves++; budget.acceptedMoves++; }
      record({ type: "action", caseId: item.id, arm: "random", round, action, accepted, retainedLayoutHash: layoutHash(state.layout) });
    }
    if (state.status === "pending") state.status = "complete";
  }
  record({ type: "search-complete", stopped, budgets });
  // Final demand is first simulated here, after BOTH model arms and the random baseline finish search.
  for (const item of cases) for (const state of states.filter(row => row.caseId === item.id)) {
    if (budgets[state.arm].simulations + item.finalDays.length * 2 > plan.maxSimulationsPerArm) continue;
    state.initialFinal = score(item, state, item.initial, item.finalDays, "initial-final");
    state.championFinal = score(item, state, state.layout, item.finalDays, "champion-final");
  }
  assertFrozen(plan);
  const report = { schemaVersion: 1, completed: stopped === null, stopped, planHash: contentHash(plan), ...summarizeOptimizerResults(cases, states, budgets), cases: states };
  write(join(plan.outputDirectory, "metrics.json"), report);
  return report;
}
