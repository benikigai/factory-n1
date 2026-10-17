import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { graderHash } from "../sim/version.ts";
import { SPLITS } from "../sim/scenarios.ts";
import type { Layout } from "../sim/types.ts";
import { validateForTask } from "../tasks/task.ts";
import type { DemandDay } from "./critic.ts";
import { buildingHash, contentHash, layoutHash } from "./generate.ts";
import { legalMoveActions, type OptimizerCase } from "./optimizer-data.ts";
import { geometricTeacherPlan } from "./optimizer-v2-data.ts";
import { applyAction, betterCandidate, measureLayout, optimizerMessages, parseAction, OPTIMIZER_PROMPT_PROFILE, type OptimizerAction, type OptimizerAttempt, type OptimizerMeasurement } from "./optimizer.ts";
import { optimizerTokenReservation, type OptimizerCall, type OptimizerReply } from "./optimizer-evaluate.ts";

export const V2_BASE_CHECKPOINT = "nvidia/Llama-3.1-Nemotron-Nano-8B-v1@54641c1611fcff44fa4865626462445e0a153fc7";
export const V1_DATASET = { graderHash: "493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4", files: { "train.jsonl": "39622e2529c53607ec890c587d2faa0ab41b2bd40b5048c8148e53725a9f6895", "validation.jsonl": "11e7d2c849d50112af9fb7d986c704516c9c75e6c74ee6fc00eb34e2d4dac52c" } };
export const V2_MODELS = ["factory-optimizer-base", "factory-optimizer-v1", "factory-optimizer-old3", "factory-optimizer-v2"] as const;
export type V2Model = typeof V2_MODELS[number];
export type V2Arm = V2Model | "random" | "geometric-teacher";
const ARMS: V2Arm[] = [...V2_MODELS, "random", "geometric-teacher"];
const SOURCE_FILES = ["src/training/generate.ts", "src/tasks/task.ts", "src/training/optimizer.ts", "src/training/optimizer-data.ts", "src/training/optimizer-v2-data.ts", "src/training/optimizer-evaluate.ts", "src/training/optimizer-v2-evaluate.ts", "scripts/evaluate-optimizer-v2.ts"];
const digest = (path: string) => contentHash(readFileSync(path, "utf8"));
const sources = () => Object.fromEntries(SOURCE_FILES.map(path => [path, digest(path)]));
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const read = <T = any>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const atomic = (path: string, value: unknown) => { writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); renameSync(path + ".tmp", path); };
const create = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
export interface V2ModelProvenance {
  baseCheckpoint: string; trainingJobId: string | null; epochs: number;
  taskProfile: "optimizer"; promptProfile: "nemotron8b-thinking-off-v1";
  adapterHashes: { "adapter_config.json": string; "adapter_model.safetensors": string } | null;
  dataset: { graderHash: string; files: { "train.jsonl": string; "validation.jsonl": string } } | null;
}
export interface V2Health {
  schemaVersion: 2; status: "ready"; baseCheckpoint: string; taskProfile: "optimizer"; promptProfile: "nemotron8b-thinking-off-v1";
  models: Record<V2Model, V2ModelProvenance>;
}
export interface V2Options {
  dataDirectory: string; outputDirectory: string; baseUrl: string; provenance?: V2Health;
  live: boolean; finalEval: boolean; factoryLimit: number; maxModelCalls: number; maxTokensPerArm: number;
  maxSimulationsPerArm: number; maxRuntimeMs: number; randomSeed: number;
}
function validateOptions(options: V2Options) {
  if (!options.finalEval) throw new Error("Opening fresh v2 factories requires --final-eval");
  for (const name of ["factoryLimit", "maxModelCalls", "maxTokensPerArm", "maxSimulationsPerArm", "maxRuntimeMs", "randomSeed"] as const) if (!Number.isSafeInteger(options[name]) || options[name] < 1) throw new Error(`Invalid ${name}`);
  if (options.factoryLimit > 20 || options.maxModelCalls > 960 || options.maxRuntimeMs > 3_600_000) throw new Error("V2 limits: 20 factories, 960 model requests, 60-minute evaluation");
  const url = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Invalid endpoint URL");
  if (options.live && !options.provenance) throw new Error("Live v2 evaluation requires all four model provenance records");
  if (options.provenance) validateV2Health(options.provenance, options.provenance);
}
export function validateV2Health(value: unknown, expected: V2Health): V2Health {
  const h = value as V2Health;
  if (!h || h.schemaVersion !== 2 || h.status !== "ready" || h.taskProfile !== "optimizer" || h.promptProfile !== "nemotron8b-thinking-off-v1" || h.baseCheckpoint !== V2_BASE_CHECKPOINT || !isDeepStrictEqual(h, expected) || !isDeepStrictEqual(Object.keys(h.models ?? {}).sort(), [...V2_MODELS].sort())) throw new Error("V2 health does not match frozen model provenance");
  for (const [index, alias] of V2_MODELS.entries()) {
    const m = h.models[alias];
    if (!m || m.baseCheckpoint !== h.baseCheckpoint || m.taskProfile !== h.taskProfile || m.promptProfile !== h.promptProfile || m.epochs !== [0, 1, 3, 1][index]) throw new Error("Wrong checkpoint, profile or epoch arm");
    if (index === 0) { if (m.trainingJobId !== null || m.adapterHashes !== null || m.dataset !== null) throw new Error("Base arm must have no adapter"); continue; }
    if (!m.trainingJobId || !sha(m.adapterHashes?.["adapter_config.json"]) || !sha(m.adapterHashes?.["adapter_model.safetensors"]) || !sha(m.dataset?.graderHash) || !sha(m.dataset?.files["train.jsonl"]) || !sha(m.dataset?.files["validation.jsonl"])) throw new Error("Missing immutable adapter or training provenance");
  }
  if (!isDeepStrictEqual(h.models[V2_MODELS[1]].dataset, V1_DATASET) || !isDeepStrictEqual(h.models[V2_MODELS[2]].dataset, V1_DATASET)) throw new Error("Old three-epoch control must use the original v1 dataset");
  if (h.models["factory-optimizer-v2"].dataset!.graderHash !== V1_DATASET.graderHash) throw new Error("V2 uses a different grader");
  if (new Set(V2_MODELS.slice(1).map(alias => h.models[alias].trainingJobId)).size !== 3 || new Set(V2_MODELS.slice(1).map(alias => h.models[alias].adapterHashes!["adapter_model.safetensors"])).size !== 3) throw new Error("Adapter comparison arms must be distinct");
  return h;
}
export function freezeV2Evaluation(options: V2Options) {
  validateOptions(options);
  const outputDirectory = resolve(options.outputDirectory), dataDirectory = resolve(options.dataDirectory);
  if (!outputDirectory.startsWith(`${resolve("runs/optimizer-eval")}/`) || existsSync(outputDirectory)) throw new Error("Use a new output directory inside runs/optimizer-eval");
  const manifest = read(join(dataDirectory, "manifest.json")), file = manifest.files?.["test-factories.jsonl"];
  if (!file || !sha(file.sha256) || !Number.isSafeInteger(file.bytes) || manifest.taskProfile !== "optimizer" || manifest.promptProfile !== OPTIMIZER_PROMPT_PROFILE || manifest.graderHash !== graderHash() || manifest.sourceHashes?.["src/training/optimizer.ts"] !== digest("src/training/optimizer.ts")) throw new Error("Invalid v2 data, canonical prompt or grader hash");
  if (options.provenance) {
    const data = options.provenance.models["factory-optimizer-v2"].dataset!;
    if (data.graderHash !== manifest.graderHash || Object.entries(data.files).some(([name, hash]) => manifest.files[name]?.sha256 !== hash)) throw new Error("V2 adapter does not match selected training dataset");
  }
  const plan = { schemaVersion: 2, ...options, outputDirectory, dataDirectory, createdAt: new Date().toISOString(), manifestHash: digest(join(dataDirectory, "manifest.json")), datasetHash: file.sha256 as string, datasetBytes: file.bytes as number, graderHash: graderHash(), sourceHashes: sources(), proposalsPerFactory: 12, maxOutputTokens: 128, temperature: 0, automaticRetries: 0, snapshots: [3, 12], modelAliases: V2_MODELS, selection: "First factoryLimit cases sorted by stable ID, never by score", teacherScope: "Privileged deterministic planner; all planning simulations and CPU time reported separately from replay opportunities" };
  mkdirSync(outputDirectory, { recursive: true }); create(join(outputDirectory, "evaluation-plan.json"), plan);
  return plan;
}
export type V2Plan = ReturnType<typeof freezeV2Evaluation>;
export function assertV2Plan(plan: V2Plan) {
  validateOptions(plan);
  if (!isDeepStrictEqual(read(join(plan.outputDirectory, "evaluation-plan.json")), plan) || digest(join(plan.dataDirectory, "manifest.json")) !== plan.manifestHash || graderHash() !== plan.graderHash || !isDeepStrictEqual(sources(), plan.sourceHashes)) throw new Error("Frozen v2 plan, data manifest, grader or source changed");
}
export function readV2Cases(plan: V2Plan): OptimizerCase[] {
  assertV2Plan(plan);
  if (plan.live) { const receipt = read(join(plan.outputDirectory, "health-receipt.json")); if (receipt.planHash !== contentHash(plan)) throw new Error("Health belongs to another plan"); validateV2Health(receipt.health, plan.provenance!); }
  const path = join(plan.dataDirectory, "test-factories.jsonl");
  if (digest(path) !== plan.datasetHash || readFileSync(path).length !== plan.datasetBytes) throw new Error("Held-out v2 bytes changed");
  const manifest = read(join(plan.dataDirectory, "manifest.json"));
  const buildings = new Set<string>([...(manifest.excludedBuildingHashes ?? []), ...(manifest.splitBuildingHashes?.train ?? []), ...(manifest.splitBuildingHashes?.validation ?? [])]);
  const seeds = new Set<number>([...Object.values(SPLITS).flat().map(d => d.seed), ...(manifest.excludedDemandSeeds ?? []), ...(manifest.splitDemandSeeds?.train ?? []), ...(manifest.splitDemandSeeds?.validation ?? [])]);
  const ids = new Set<string>(), layouts = new Set<string>();
  const all = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line) as OptimizerCase).sort((a, b) => a.id.localeCompare(b.id));
  for (const c of all) {
    if (!c.id || !/^[a-zA-Z0-9_-]+$/.test(c.id) || ids.has(c.id) || c.split !== "test" || c.buildingHash !== buildingHash(c.task) || buildings.has(c.buildingHash) || c.initialLayoutHash !== layoutHash(c.initial) || layouts.has(c.initialLayoutHash) || validateForTask(c.initial, c.task).length) throw new Error("Invalid, duplicate or previously used v2 test factory");
    ids.add(c.id); buildings.add(c.buildingHash); layouts.add(c.initialLayoutHash);
    for (const days of [c.feedbackDays, c.finalDays]) {
      if (days.length !== 4 || new Set(days.map(d => d.profile)).size !== 4 || days.some(d => !["normal", "peak", "fragile", "skewed"].includes(d.profile))) throw new Error("Need four separate demand profiles");
      for (const d of days) { if (!Number.isSafeInteger(d.seed) || seeds.has(d.seed) || d.count !== 100) throw new Error("Demand seeds overlap or are invalid"); seeds.add(d.seed); }
    }
  }
  if (all.length < plan.factoryLimit) throw new Error("Insufficient distinct test factories");
  const selected = all.slice(0, plan.factoryLimit), selection = { hash: contentHash(selected), ids: selected.map(c => c.id) }, target = join(plan.outputDirectory, "selection.json");
  if (existsSync(target)) { if (!isDeepStrictEqual(read(target), selection)) throw new Error("Frozen selection changed"); } else create(target, selection);
  return selected;
}
interface V2State { caseId: string; arm: V2Arm; nextRound: number; stopped: boolean; layout: Layout; history: OptimizerAttempt[]; feedback?: OptimizerMeasurement; snapshot3?: Layout; accepted: number; invalid: number; teacher?: ReturnType<typeof geometricTeacherPlan>; teacherMs?: number; final?: { initial: OptimizerMeasurement; round3: OptimizerMeasurement; round12: OptimizerMeasurement } }
interface Checkpoint { planHash: string; casesHash: string; startedAt: number; searchFinished: boolean; terminalReason: string | null; states: V2State[] }
interface RequestReceipt { id: string; arm: V2Model; caseId: string; round: number; requestHash: string; request: Parameters<OptimizerCall>[0]; reservedTokens: number; status: "pending" | "resolved" | "unknown"; startedAt: number; latencyMs?: number; reply?: OptimizerReply; error?: string }
interface SimulationReceipt { id: string; arm: V2Arm; inputHash: string; attempts: number; dayCount: number; status: "pending" | "resolved"; result?: OptimizerMeasurement }
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const zero = (m: OptimizerMeasurement) => m.valid && m.days.length > 0 && m.days.every(d => d.metrics.damaged === 0);
export function summarizeV2(checkpoint: Checkpoint, requests: RequestReceipt[], simulations: SimulationReceipt[], count: number) {
  return Object.fromEntries(ARMS.map(arm => {
    const states = checkpoint.states.filter(s => s.arm === arm), calls = requests.filter(r => r.arm === arm), sims = simulations.filter(r => r.arm === arm);
    const snapshots = Object.fromEntries((["round3", "round12"] as const).map(key => {
      const rows = states.filter(s => s.final), deltas = rows.map(s => s.final![key].objective! - s.final!.initial.objective!);
      return [key, { factories: count, scored: rows.length, missing: count - rows.length, zeroDamage: rows.filter(s => zero(s.final![key])).length, goalPasses: rows.filter(s => s.final![key].goalMet).length, meanObjective: mean(rows.map(s => s.final![key].objective!)), meanObjectiveDelta: mean(deltas), improvements: deltas.filter(d => d < 0).length }];
    }));
    return [arm, { label: arm === "geometric-teacher" ? "Privileged deterministic planner plus gated replay" : arm === "random" ? "Seeded legal random moves" : arm, snapshots, completedSearches: states.filter(s => s.stopped || s.nextRound >= 12).length, offeredProposals: count * 12, attemptedProposals: states.reduce((sum, s) => sum + s.nextRound, 0), acceptedMoves: states.reduce((sum, s) => sum + s.accepted, 0), invalidActions: states.reduce((sum, s) => sum + s.invalid, 0), modelCalls: calls.length, knownTokens: calls.reduce((sum, r) => sum + (r.status === "resolved" ? r.reply?.usage?.totalTokens ?? 0 : 0), 0), reservedUnknownTokens: calls.reduce((sum, r) => sum + (r.status !== "resolved" ? r.reservedTokens : 0), 0), latencyMs: calls.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0), replaySimulations: sims.reduce((sum, r) => sum + r.attempts * r.dayCount, 0), planningSimulations: states.reduce((sum, s) => sum + (s.teacher?.feedbackSimulationCalls ?? 0), 0), planningMs: states.reduce((sum, s) => sum + (s.teacherMs ?? 0), 0), planningReceipts: states.flatMap(s => s.teacher ? [{ caseId: s.caseId, ...s.teacher }] : []) }];
  }));
}
export type V2Call = (request: Parameters<OptimizerCall>[0] & { timeoutMs: number }) => ReturnType<OptimizerCall>;
export interface V2Dependencies { measure?: typeof measureLayout; teacher?: typeof geometricTeacherPlan; afterReceipt?: (id: string) => void; now?: () => number }
/** Receipt-first durability: resolved replies can be applied after restart; pending/unknown calls are never dispatched again. */
export async function runV2Evaluation(plan: V2Plan, cases: OptimizerCase[], call: V2Call, dependencies: V2Dependencies = {}) {
  if (!plan.live) throw new Error("Model calls require --live"); assertV2Plan(plan);
  if (read(join(plan.outputDirectory, "selection.json")).hash !== contentHash(cases)) throw new Error("Selected factories changed");
  validateV2Health(read(join(plan.outputDirectory, "health-receipt.json")).health, plan.provenance!);
  const now = dependencies.now ?? Date.now, measure = dependencies.measure ?? measureLayout, teacher = dependencies.teacher ?? geometricTeacherPlan;
  const checkpointPath = join(plan.outputDirectory, "checkpoint.json"), metricsPath = join(plan.outputDirectory, "metrics.json");
  if (existsSync(metricsPath)) return read(metricsPath);
  const requestDirectory = join(plan.outputDirectory, "requests"), simulationDirectory = join(plan.outputDirectory, "simulations");
  mkdirSync(requestDirectory, { recursive: true }); mkdirSync(simulationDirectory, { recursive: true });
  const requests = new Map<string, RequestReceipt>(readdirSync(requestDirectory).filter(p => p.endsWith(".json")).map(p => { const r = read<RequestReceipt>(join(requestDirectory, p)); return [r.id, r]; }));
  const simulations = new Map<string, SimulationReceipt>(readdirSync(simulationDirectory).filter(p => p.endsWith(".json")).map(p => { const r = read<SimulationReceipt>(join(simulationDirectory, p)); return [r.id, r]; }));
  const checkpoint: Checkpoint = existsSync(checkpointPath) ? read(checkpointPath) : { planHash: contentHash(plan), casesHash: contentHash(cases), startedAt: now(), searchFinished: false, terminalReason: null, states: cases.flatMap(c => ARMS.map(arm => ({ caseId: c.id, arm, nextRound: 0, stopped: false, layout: structuredClone(c.initial), history: [], accepted: 0, invalid: 0 }))) };
  if (checkpoint.planHash !== contentHash(plan) || checkpoint.casesHash !== contentHash(cases)) throw new Error("Checkpoint belongs to another frozen run");
  const save = () => atomic(checkpointPath, checkpoint);
  const record = (event: unknown) => appendFileSync(join(plan.outputDirectory, "events.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 });
  save();
  const budget = (arm: V2Model) => { const r = [...requests.values()].filter(x => x.arm === arm); return { calls: r.length, tokens: r.reduce((sum, x) => sum + (x.status === "resolved" ? x.reply!.usage!.totalTokens : x.reservedTokens), 0) }; };
  const score = (c: OptimizerCase, state: V2State, layout: Layout, days: DemandDay[], stage: string) => {
    const id = `${c.id}-${state.arm}-${stage}`, path = join(simulationDirectory, id + ".json"), inputHash = contentHash({ layout, days, task: c.task });
    const prior = simulations.get(id);
    if (prior && prior.inputHash !== inputHash) throw new Error("Simulation checkpoint input changed");
    if (prior?.status === "resolved") return prior.result!;
    if ([...simulations.values()].filter(s => s.arm === state.arm).reduce((sum, s) => sum + s.attempts * s.dayCount, 0) + days.length > plan.maxSimulationsPerArm) throw new Error("simulation_cap_exhausted");
    const receipt: SimulationReceipt = { id, arm: state.arm, inputHash, dayCount: days.length, attempts: (prior?.attempts ?? 0) + 1, status: "pending" };
    simulations.set(id, receipt); atomic(path, receipt);
    receipt.result = measure(c.task, layout, days); receipt.status = "resolved"; atomic(path, receipt); return receipt.result;
  };
  if ([...requests.values()].some(r => r.status !== "resolved")) checkpoint.terminalReason = "unresolved_request_never_retried";
  else if ([...requests.values()].some(r => r.error)) checkpoint.terminalReason = "prior_request_limit_violation";
  if (plan.maxModelCalls < cases.length * 48 || plan.maxSimulationsPerArm < cases.reduce((sum, c) => sum + c.feedbackDays.length * 13 + c.finalDays.length * 3, 0)) checkpoint.terminalReason = "budget_cannot_cover_offered_evaluation";
  try {
    search: for (const [caseIndex, c] of cases.entries()) {
      if (checkpoint.searchFinished || checkpoint.terminalReason) break;
      for (let round = 0; round < 12; round++) {
        const rotation = (caseIndex + round) % V2_MODELS.length;
        const order: V2Arm[] = [...V2_MODELS.slice(rotation), ...V2_MODELS.slice(0, rotation), "random", "geometric-teacher"];
        for (const arm of order) {
          const state = checkpoint.states.find(s => s.caseId === c.id && s.arm === arm)!;
          if (state.stopped || state.nextRound > round) continue;
          if (now() - checkpoint.startedAt >= plan.maxRuntimeMs) { checkpoint.terminalReason = "runtime_cap_exhausted"; break search; }
          if (!state.feedback) state.feedback = score(c, state, state.layout, c.feedbackDays, "initial-feedback");
          let raw: string;
          if (arm === "random") raw = JSON.stringify(legalMoveActions(c.task, state.layout, plan.randomSeed + caseIndex * 1009 + round, 1)[0] ?? { op: "stop" });
          else if (arm === "geometric-teacher") {
            if (!state.teacher) { const start = now(); state.teacher = teacher(c.task, c.initial, c.feedbackDays, 12); state.teacherMs = now() - start; save(); }
            raw = JSON.stringify(state.teacher.actions?.[round] ?? { op: "stop" });
          } else {
            const id = `${c.id}-${arm}-${round}`, path = join(requestDirectory, id + ".json");
            const request = { model: arm, messages: optimizerMessages(c.task, state.layout, state.feedback, state.history), temperature: 0 as const, maxOutputTokens: 128 };
            const requestHash = contentHash(request), previous = requests.get(id);
            if (previous && previous.requestHash !== requestHash) throw new Error("Request checkpoint prompt changed");
            let receipt: RequestReceipt;
            if (previous) { if (previous.status !== "resolved") { checkpoint.terminalReason = "unresolved_request_never_retried"; break search; } receipt = previous; }
            else {
              const reserve = optimizerTokenReservation(request.messages, 128), used = budget(arm);
              if (requests.size >= plan.maxModelCalls || used.calls >= cases.length * 12 || used.tokens + reserve > plan.maxTokensPerArm) { checkpoint.terminalReason = "token_or_call_cap_exhausted"; break search; }
              receipt = { id, arm, caseId: c.id, round, request, requestHash, reservedTokens: reserve, status: "pending", startedAt: now() };
              create(path, receipt); requests.set(id, receipt); record({ type: "request-pending", id, arm, caseId: c.id, round, reservedTokens: reserve });
              try { receipt.reply = await call({ ...request, timeoutMs: Math.max(1, Math.min(90_000, plan.maxRuntimeMs - (now() - checkpoint.startedAt))) }); }
              catch { receipt.status = "unknown"; receipt.error = "provider_failure_charge_unknown"; receipt.latencyMs = now() - receipt.startedAt; atomic(path, receipt); checkpoint.terminalReason = receipt.error; break search; }
              receipt.latencyMs = now() - receipt.startedAt;
              const u = receipt.reply.usage;
              if (!u || ![u.promptTokens, u.completionTokens, u.totalTokens].every(n => Number.isSafeInteger(n) && n >= 0) || u.totalTokens !== u.promptTokens + u.completionTokens) { receipt.status = "unknown"; receipt.error = "invalid_usage_charge_unknown"; }
              else if (u.completionTokens > 128 || u.totalTokens > reserve) { receipt.status = "resolved"; receipt.error = "provider_exceeded_reserved_bound"; }
              else receipt.status = "resolved";
              atomic(path, receipt); record({ type: "request-received", id, status: receipt.status, latencyMs: receipt.latencyMs, error: receipt.error });
              if (receipt.error) { checkpoint.terminalReason = receipt.error; break search; }
              dependencies.afterReceipt?.(id);
            }
            raw = receipt.reply!.content ?? "";
          }
          let action: OptimizerAction | undefined;
          let attempt: OptimizerAttempt;
          try {
            action = parseAction(raw); const candidate = applyAction(c.task, state.layout, action);
            if (action.op === "stop") { state.stopped = true; attempt = { action, status: "stopped" }; }
            else {
              const result = score(c, state, candidate, c.feedbackDays, `candidate-${round}`), accepted = betterCandidate(state.feedback, result);
              attempt = { action, status: accepted ? "accepted" : "rejected", feedback: result };
              if (accepted) { state.layout = candidate; state.feedback = result; state.accepted++; }
            }
          } catch (error) {
            if (error instanceof Error && error.message === "simulation_cap_exhausted") throw error;
            state.invalid++; attempt = { ...(action ? { action } : { rawText: raw.slice(0, 512) }), status: "invalid", reason: error instanceof Error ? error.message.slice(0, 512) : "Invalid action" };
          }
          state.history = [...state.history.slice(-2), attempt]; state.nextRound = round + 1;
          if (state.nextRound === 3 || state.stopped && !state.snapshot3) state.snapshot3 = structuredClone(state.layout);
          record({ type: "step", caseId: c.id, arm, round, attempt, retainedLayoutHash: layoutHash(state.layout) }); save();
        }
      }
    }
  } catch (error) {
    // Unexpected local interruption keeps a resumable checkpoint and every durable request receipt.
    save(); throw error;
  }
  checkpoint.searchFinished = true; save(); record({ type: "all-searches-ended", terminalReason: checkpoint.terminalReason });
  // Initial, first-three and final-twelve snapshots are scored only now, after every arm's search ends.
  for (const c of cases) for (const state of checkpoint.states.filter(s => s.caseId === c.id)) {
    if (state.final) continue;
    state.snapshot3 ??= structuredClone(state.layout);
    try { state.final = { initial: score(c, state, c.initial, c.finalDays, "final-initial"), round3: score(c, state, state.snapshot3, c.finalDays, "final-three"), round12: score(c, state, state.layout, c.finalDays, "final-twelve") }; }
    catch (error) { if (error instanceof Error && error.message === "simulation_cap_exhausted") { checkpoint.terminalReason ??= error.message; break; } throw error; }
    save();
  }
  assertV2Plan(plan);
  const result = { schemaVersion: 2, completed: checkpoint.terminalReason === null, terminalReason: checkpoint.terminalReason, planHash: contentHash(plan), elapsedMs: now() - checkpoint.startedAt, scope: "Four same-base model policies, two labeled deterministic baselines, measured after 3 and 12 proposals. Interrupted searches stay in all-factory denominators; only completed runs support model comparisons.", overall: summarizeV2(checkpoint, [...requests.values()], [...simulations.values()], cases.length), cases: checkpoint.states };
  create(metricsPath, result); return result;
}
