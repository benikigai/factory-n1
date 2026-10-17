import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario, SPLITS } from "../src/sim/scenarios.ts";
import { DEFAULT_DOD, evaluateDoD } from "../src/sim/dod.ts";
import { graderHash } from "../src/sim/version.ts";
import { validateForTask } from "../src/tasks/task.ts";
import { buildingHash, contentHash, generateBuilding, layoutHash } from "../src/training/generate.ts";
import { legalMoveActions } from "../src/training/optimizer-data.ts";
import { geometricTeacherPlan } from "../src/training/optimizer-v2-data.ts";
import { applyAction, optimizerMessages, parseAction } from "../src/training/optimizer.ts";

const BASE = "nvidia/Llama-3.1-Nemotron-Nano-8B-v1@54641c1611fcff44fa4865626462445e0a153fc7";
const GRADER = "493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4";
const MODELS = ["factory-optimizer-base", "factory-optimizer-v1", "factory-optimizer-old3", "factory-optimizer-v2"];
const ARMS = [...MODELS, "random", "geometric-teacher"];
const OLD_DATA = { graderHash: GRADER, files: { "train.jsonl": "39622e2529c53607ec890c587d2faa0ab41b2bd40b5048c8148e53725a9f6895", "validation.jsonl": "11e7d2c849d50112af9fb7d986c704516c9c75e6c74ee6fc00eb34e2d4dac52c" } };
const json = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const jsonl = (path: string): any[] => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const eq = (a: unknown, b: unknown, message: string) => assert.deepEqual(a, b, message);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const key = (caseId: string, arm: string) => `${caseId}:${arm}`;
const zero = (measurement: any) => measurement.days.every((day: any) => day.metrics.damaged === 0);

interface AuditOptions {
  confirmedComplete: boolean;
  output?: string;
  recovered?: { v1: string; old3: string; v2: string };
  bundle?: string;
  fixture?: boolean;
  continuation?: { includedIds: string[]; excludedIds: string[]; originalEvents: any[]; primaryOverall: any; runtime?: { originalRequestIds: string[]; originalStartedAt: number; originalEndedAt: number; resumedAt: number; effectiveDeadline: number } };
}

function verifyTraining(plan: any, options: AuditOptions) {
  if (options.fixture) return { verified: false, reason: "Synthetic auditor self-test; no trained weights" };
  assert.ok(options.recovered && options.bundle, "Pass --v1, --old3, --v2 recovered directories and --bundle for a complete provenance audit");
  const roots = options.recovered;
  const records: any[] = [];
  for (const [index, name] of (["v1", "old3", "v2"] as const).entries()) {
    const root = roots[name], manifest = json(join(root, "manifest.json"));
    const proof = plan.provenance.models[MODELS[index + 1]], epochs = name === "old3" ? 3 : 1;
    assert.equal(`${manifest.baseModel}@${manifest.baseRevision}`, BASE);
    assert.equal(manifest.status, "complete"); assert.equal(manifest.smoke, false);
    assert.equal(manifest.taskProfile, "optimizer"); assert.equal(manifest.promptProfile, "nemotron8b-thinking-off-v1");
    assert.equal(manifest.epochs, epochs); assert.equal(manifest.optimizerSteps, 150 * epochs);
    assert.equal(manifest.rank, 8); assert.equal(manifest.alpha, 16); assert.equal(manifest.seed, 20261017);
    assert.equal(manifest.trainingJobId, proof.trainingJobId);
    eq(manifest.dataset, proof.dataset, `Recovered ${name} dataset`); eq(manifest.adapterHashes, proof.adapterHashes, `Recovered ${name} hashes`);
    for (const [file, hash] of Object.entries(proof.adapterHashes)) assert.equal(hashFile(join(root, "adapter", file)), hash, `Recovered ${name} adapter ${file}`);
    const config = json(join(root, "adapter/adapter_config.json"));
    assert.equal(config.r, 8); assert.equal(config.lora_alpha, 16);
    eq([...config.target_modules].sort(), ["k_proj", "o_proj", "q_proj", "v_proj"], "Same LoRA target modules");
    const verifiedEpochs: number[] = [];
    if (name !== "v1") {
      assert.equal(manifest.completedEpochs, epochs); assert.equal(manifest.epochCheckpoints.length, epochs);
      for (const snapshot of manifest.epochCheckpoints) {
        assert.equal(snapshot.optimizerSteps, snapshot.epoch * 150);
        const epochRoot = join(root, "epochs", String(snapshot.epoch), "adapter");
        for (const [file, hash] of Object.entries(snapshot.adapterHashes)) assert.equal(hashFile(join(epochRoot, file)), hash, `Recovered ${name} epoch ${snapshot.epoch} ${file}`);
        verifiedEpochs.push(snapshot.epoch);
      }
      eq(manifest.epochCheckpoints.at(-1).adapterHashes, manifest.adapterHashes, "Selected adapter is the prescribed final epoch");
      assert.equal(manifest.tokenLengths.train.rows, 1200); assert.equal(manifest.tokenLengths.validation.rows, 200);
    }
    records.push({ condition: name, epochs, optimizerSteps: manifest.optimizerSteps, trainingJobId: manifest.trainingJobId, manifestHash: hashFile(join(root, "manifest.json")), adapterHashes: proof.adapterHashes, verifiedEpochs });
  }
  const bundleRoot = options.bundle, bundle = json(join(bundleRoot, "bundle-manifest.json"));
  assert.equal(`${bundle.baseModel}@${bundle.baseRevision}`, BASE);
  for (const [file, hash] of Object.entries(bundle.files)) {
    assert.ok(!file.includes("test-factories") && !file.includes("raw-transitions"), "Training bundle excludes held-out and raw evaluation data");
    assert.equal(hashFile(join(bundleRoot, file)), hash, `Frozen bundle ${file}`);
  }
  eq(bundle.datasets.old, OLD_DATA, "Bundled old dataset");
  eq(bundle.datasets.new, plan.provenance.models[MODELS[3]].dataset, "Bundled new dataset");
  for (const label of ["old", "new"]) for (const name of ["train.jsonl", "validation.jsonl"]) {
    assert.equal(hashFile(join(bundleRoot, "data", label, name)), bundle.datasets[label].files[name], `Bundled ${label} data matches training receipt`);
  }
  for (const file of ["common.py", "train_comparison.py", "serve_comparison.py"]) assert.equal(hashFile(join(bundleRoot, "code", file)), hashFile(join("training/vm", file)), `Current and frozen training source ${file}`);
  return { verified: true, records, bundleManifestHash: hashFile(join(bundleRoot, "bundle-manifest.json")) };
}

export function auditV2Results(directory: string, options: AuditOptions) {
  assert.equal(options.confirmedComplete, true, "Explicit completion confirmation is required before opening test data");
  const root = resolve(directory), reported = json(join(root, "metrics.json"));
  if (options.continuation) {
    assert.equal(reported.internalOnly, true);
    assert.equal(reported.completed, false, "Internal twenty-position result must not claim full completion");
    assert.equal(reported.internalSearchCompleted, true, "Included continuation searches completed");
  } else assert.equal(reported.completed, true, "Audit complete comparisons only; interrupted results cannot establish a winner");
  assert.equal(reported.terminalReason, null);
  const plan = json(join(root, "evaluation-plan.json")), checkpoint = json(join(root, "checkpoint.json"));
  const events = [...(options.continuation?.originalEvents ?? []), ...jsonl(join(root, "events.jsonl"))];
  assert.equal(checkpoint.searchFinished, true); assert.equal(checkpoint.terminalReason, null);
  assert.ok(events.some(event => event.type === "all-searches-ended" && event.terminalReason === null), "Durable search completion marker required");
  const planHash = contentHash(plan);
  assert.equal(reported.planHash, planHash); assert.equal(checkpoint.planHash, planHash);
  assert.equal(plan.schemaVersion, 2); assert.equal(plan.live, true); assert.equal(plan.finalEval, true);
  if (options.continuation) {
    assert.equal(options.fixture, undefined);
    assert.equal(options.continuation.includedIds.length, 19);
    assert.equal(options.continuation.excludedIds.length, 1);
  }
  assert.equal(plan.factoryLimit, options.fixture ? 2 : 20);
  assert.equal(plan.proposalsPerFactory, 12); assert.equal(plan.maxOutputTokens, 128); assert.equal(plan.temperature, 0); assert.equal(plan.automaticRetries, 0);
  eq(plan.snapshots, [3, 12], "Frozen 3/12 proposal snapshots"); eq(plan.modelAliases, MODELS, "Four prescribed model arms");
  assert.ok(plan.maxModelCalls <= 960 && plan.maxModelCalls >= plan.factoryLimit * 48);
  assert.equal(plan.graderHash, GRADER); assert.equal(graderHash(), GRADER);
  for (const [path, hash] of Object.entries(plan.sourceHashes)) assert.equal(hashFile(path), hash, `Frozen evaluation source ${path}`);
  const health = json(join(root, "health-receipt.json"));
  assert.equal(health.planHash, planHash); eq(health.health, plan.provenance, "Live server proof matches frozen proof");
  const proof = plan.provenance;
  assert.equal(proof.status, "ready"); assert.equal(proof.schemaVersion, 2); assert.equal(proof.baseCheckpoint, BASE);
  assert.equal(proof.taskProfile, "optimizer"); assert.equal(proof.promptProfile, "nemotron8b-thinking-off-v1");
  eq(Object.keys(proof.models).sort(), [...MODELS].sort(), "Only the four prescribed aliases");
  for (const [i, alias] of MODELS.entries()) {
    const model = proof.models[alias];
    assert.equal(model.baseCheckpoint, BASE); assert.equal(model.epochs, [0, 1, 3, 1][i]);
    assert.equal(model.taskProfile, proof.taskProfile); assert.equal(model.promptProfile, proof.promptProfile);
    if (!i) { assert.equal(model.trainingJobId, null); assert.equal(model.dataset, null); assert.equal(model.adapterHashes, null); }
    else { assert.equal(model.dataset.graderHash, GRADER); assert.ok(model.trainingJobId); }
  }
  eq(proof.models[MODELS[1]].dataset, OLD_DATA, "Archived one-epoch data"); eq(proof.models[MODELS[2]].dataset, OLD_DATA, "Old-data three-epoch control");
  assert.equal(new Set(MODELS.slice(1).map(alias => proof.models[alias].adapterHashes["adapter_model.safetensors"])).size, 3);
  const manifest = json(join(plan.dataDirectory, "manifest.json"));
  assert.equal(hashFile(join(plan.dataDirectory, "manifest.json")), plan.manifestHash);
  assert.equal(manifest.graderHash, GRADER); assert.equal(manifest.promptProfile, "factory-single-move-optimizer-v1");
  for (const [path, hash] of Object.entries(manifest.sourceHashes)) assert.equal(hashFile(path), hash, `Frozen data source ${path}`);
  for (const name of ["train.jsonl", "validation.jsonl"]) {
    const path = join(plan.dataDirectory, name);
    assert.equal(hashFile(path), manifest.files[name].sha256); assert.equal(readFileSync(path).length, manifest.files[name].bytes);
    assert.equal(hashFile(path), proof.models[MODELS[3]].dataset.files[name]);
  }
  const training = verifyTraining(plan, options);

  // This is the first access to the sealed test. Completion and provenance have
  // already passed; none of its contents can feed a still-running search.
  const testPath = join(plan.dataDirectory, "test-factories.jsonl");
  assert.equal(hashFile(testPath), plan.datasetHash); assert.equal(readFileSync(testPath).length, plan.datasetBytes);
  const allCases = jsonl(testPath).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(allCases.length, options.fixture ? 2 : 20, "The original sealed population remains intact");
  const cases = options.continuation ? allCases.filter(c => !options.continuation!.excludedIds.includes(c.id)) : allCases;
  assert.equal(cases.length, options.continuation ? 19 : plan.factoryLimit, "Every included factory remains in the primary denominator");
  if (options.continuation) eq(cases.map(c => c.id), options.continuation.includedIds, "Only the declared interruption-based exclusion is applied");
  const selection = json(join(root, "selection.json"));
  assert.equal(selection.hash, contentHash(allCases)); assert.equal(checkpoint.casesHash, contentHash(allCases));
  eq(selection.ids, allCases.map(c => c.id), "Engine preserves original positions and never sorts on score");
  const seenBuildings = new Set([...(manifest.excludedBuildingHashes ?? []), ...manifest.splitBuildingHashes.train, ...manifest.splitBuildingHashes.validation]);
  const seenSeeds = new Set([...(manifest.excludedDemandSeeds ?? []), ...Object.values(SPLITS).flat().map(d => d.seed), ...manifest.splitDemandSeeds.train, ...manifest.splitDemandSeeds.validation]);
  const ids = new Set<string>(), layouts = new Set<string>();
  for (const c of allCases) {
    assert.equal(c.split, "test"); assert.equal(c.buildingHash, buildingHash(c.task)); assert.equal(c.initialLayoutHash, layoutHash(c.initial));
    assert.ok(!seenBuildings.has(c.buildingHash) && !ids.has(c.id) && !layouts.has(c.initialLayoutHash), "New, unique factory geometry and initial layout");
    seenBuildings.add(c.buildingHash); ids.add(c.id); layouts.add(c.initialLayoutHash);
    eq(validateForTask(c.initial, c.task), [], "Legal held-out start");
    for (const days of [c.feedbackDays, c.finalDays]) {
      eq(days.map((day: any) => day.profile).sort(), ["fragile", "normal", "peak", "skewed"], "Four matched profiles");
      for (const day of days) { assert.ok(Number.isSafeInteger(day.seed) && !seenSeeds.has(day.seed)); assert.equal(day.count, 100); seenSeeds.add(day.seed); }
    }
  }
  eq(allCases.map(c => c.buildingHash).sort(), [...manifest.splitBuildingHashes.test].sort(), "Sealed geometry matches preflight metadata");
  if (manifest.splitDemandSeeds.test) eq(allCases.flatMap(c => [...c.feedbackDays, ...c.finalDays].map(d => d.seed)).sort((a, b) => a - b), [...manifest.splitDemandSeeds.test].sort((a, b) => a - b), "Sealed demand matches preflight metadata");
  const readReceipts = (name: string) => readdirSync(join(root, name)).filter(file => file.endsWith(".json")).map(file => {
    const value = json(join(root, name, file)); assert.equal(file, `${value.id}.json`); return value;
  });
  const requests = readReceipts("requests"), simulations = readReceipts("simulations");
  const requestMap = new Map(requests.map(r => [r.id, r])), simulationMap = new Map(simulations.map(r => [r.id, r]));
  assert.equal(requestMap.size, requests.length); assert.equal(simulationMap.size, simulations.length);
  const usedRequests = new Set<string>(), usedSimulations = new Set<string>(), responseIds = new Set<string>();
  const includedStates = checkpoint.states.filter((state: any) => !options.continuation?.excludedIds.includes(state.caseId));
  const recordedStates = new Map(includedStates.map((state: any) => [key(state.caseId, state.arm), state]));
  assert.equal(recordedStates.size, cases.length * ARMS.length); eq(reported.cases, checkpoint.states, "Reported final states equal durable checkpoint");
  let directSimulatorCalls = 0;
  function direct(task: any, layout: any, days: any[]) {
    eq(validateForTask(layout, task), [], "Every simulated layout is legal");
    const runs = days.map(day => simulate(layout, makeScenario(day.seed, day.profile, day.count)));
    directSimulatorCalls += runs.length;
    const dod = evaluateDoD(DEFAULT_DOD, runs), keys = ["objective", "makespan", "damaged", "missorts", "unshipped", "avgWait", "travelCells"];
    const metrics: any = Object.fromEntries(keys.map(name => [name, mean(runs.map(run => (run.metrics as any)[name]))]));
    const bottlenecks = layout.stations.filter((s: any) => ["sorter", "pack"].includes(s.kind)).map((station: any) => {
      const stats = runs.map(run => run.metrics.stations[station.id]);
      return { stationId: station.id, maxQueue: Math.max(...stats.map(s => s.maxQueue)), totalWait: mean(stats.map(s => s.totalWait)), utilization: mean(stats.map(s => s.utilization)) };
    }).sort((a: any, b: any) => b.totalWait - a.totalWait || a.stationId.localeCompare(b.stationId));
    return { valid: true, errors: [], objective: metrics.objective, goalMet: dod.passed, checks: dod.checks, metrics, bottlenecks, days: runs.map(run => ({ seed: run.scenario.seed, profile: run.scenario.profile, metrics: run.metrics })) };
  }
  function score(c: any, arm: string, layout: any, days: any[], stage: string) {
    const id = `${c.id}-${arm}-${stage}`, receipt = simulationMap.get(id);
    assert.ok(receipt, `Missing simulation receipt ${id}`); assert.ok(!usedSimulations.has(id)); usedSimulations.add(id);
    assert.equal(receipt.arm, arm); assert.equal(receipt.status, "resolved"); assert.equal(receipt.inputHash, contentHash({ layout, days, task: c.task }));
    assert.equal(receipt.dayCount, days.length); assert.ok(Number.isSafeInteger(receipt.attempts) && receipt.attempts >= 1);
    const result = direct(c.task, layout, days); eq(result, receipt.result, `Independent simulator receipt ${id}`); return result;
  }
  function accept(before: any, after: any) {
    if (after.objective >= before.objective - 1e-9) return false;
    eq(before.days.map((d: any) => [d.seed, d.profile]), after.days.map((d: any) => [d.seed, d.profile]), "Same feedback days");
    const pass = (m: any, check: any) => check.op === "==" ? m[check.metric] === check.value : check.op === "<=" ? m[check.metric] <= check.value : m[check.metric] >= check.value;
    return before.days.every((day: any, i: number) => before.checks.every((check: any) => !pass(day.metrics, check) || pass(after.days[i].metrics, check)));
  }
  const states = new Map<string, any>(cases.flatMap(c => ARMS.map(arm => [key(c.id, arm), { c, arm, nextRound: 0, stopped: false, layout: structuredClone(c.initial), history: [], accepted: 0, invalid: 0, invalidCauses: {}, feedback: null, snapshot3: null, final: null }])));
  const recordedSteps = new Map<string, any>();
  let searchEnded = false, duplicateSteps = 0, lastRank = -1;
  const pendingOrder: string[] = [], receivedOrder: string[] = [], stepModelOrder: string[] = [];
  for (const event of events) {
    if (event.type === "all-searches-ended") { assert.equal(event.terminalReason, null); searchEnded = true; continue; }
    assert.equal(searchEnded, false, "No search event may follow search completion");
    if (event.type === "request-pending") { pendingOrder.push(event.id); continue; }
    if (event.type === "request-received") { receivedOrder.push(event.id); assert.equal(event.status, "resolved"); assert.ok(!event.error); continue; }
    assert.equal(event.type, "step", "Known evaluation event");
    const state = states.get(key(event.caseId, event.arm)); assert.ok(state, "Step belongs to a selected case and prescribed arm");
    const stepKey = `${key(event.caseId, event.arm)}:${event.round}`;
    if (recordedSteps.has(stepKey)) { eq(recordedSteps.get(stepKey), event, "Crash-replayed step must be identical"); duplicateSteps++; continue; }
    recordedSteps.set(stepKey, event);
    const { c, arm } = state, caseIndex = allCases.indexOf(c), round = event.round;
    assert.equal(state.stopped, false); assert.equal(round, state.nextRound); assert.ok(round >= 0 && round < 12);
    const rotation = (caseIndex + round) % 4, order = [...MODELS.slice(rotation), ...MODELS.slice(0, rotation), "random", "geometric-teacher"];
    const rank = caseIndex * 72 + round * 6 + order.indexOf(arm);
    assert.ok(rank > lastRank, "Balanced per-round arm order"); lastRank = rank;
    if (!state.feedback) state.feedback = score(c, arm, state.layout, c.feedbackDays, "initial-feedback");
    let raw: string;
    if (arm === "random") raw = JSON.stringify(legalMoveActions(c.task, state.layout, plan.randomSeed + caseIndex * 1009 + round, 1)[0] ?? { op: "stop" });
    else if (arm === "geometric-teacher") {
      const recorded: any = recordedStates.get(key(c.id, arm));
      if (!state.teacher) {
        state.teacher = geometricTeacherPlan(c.task, c.initial, c.feedbackDays, 12);
        eq(state.teacher, recorded.teacher, "Reproducible teacher actions and planning cost");
        assert.ok(Number.isFinite(recorded.teacherMs) && recorded.teacherMs >= 0); state.teacherMs = recorded.teacherMs;
      }
      raw = JSON.stringify(state.teacher.actions?.[round] ?? { op: "stop" });
    } else {
      const id = `${c.id}-${arm}-${round}`, receipt = requestMap.get(id); assert.ok(receipt, `Missing request ${id}`);
      assert.ok(!usedRequests.has(id)); usedRequests.add(id); stepModelOrder.push(id);
      assert.equal(receipt.status, "resolved"); assert.ok(!receipt.error); assert.equal(receipt.arm, arm); assert.equal(receipt.caseId, c.id); assert.equal(receipt.round, round);
      const request = { model: arm, messages: optimizerMessages(c.task, state.layout, state.feedback, state.history), temperature: 0, maxOutputTokens: 128 };
      eq(receipt.request, request, "Exact prompt uses only reconstructed feedback state and action history"); assert.equal(receipt.requestHash, contentHash(request));
      for (const day of c.finalDays) assert.ok(!JSON.stringify(request.messages).includes(String(day.seed)), "Final demand excluded from prompts");
      assert.equal(receipt.reservedTokens, Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 4096 + 128);
      const usage = receipt.reply?.usage; assert.ok(usage);
      for (const name of ["promptTokens", "completionTokens", "totalTokens"]) assert.ok(Number.isSafeInteger(usage[name]) && usage[name] >= 0);
      assert.equal(usage.totalTokens, usage.promptTokens + usage.completionTokens); assert.ok(usage.completionTokens <= 128 && usage.totalTokens <= receipt.reservedTokens);
      assert.ok(Number.isFinite(receipt.latencyMs) && receipt.latencyMs >= 0);
      const runtime = options.continuation?.runtime;
      const inherited = runtime?.originalRequestIds.includes(receipt.id);
      const earliest = runtime ? (inherited ? runtime.originalStartedAt : runtime.resumedAt) : checkpoint.startedAt;
      const latest = runtime ? (inherited ? runtime.originalEndedAt : runtime.effectiveDeadline) : checkpoint.startedAt + plan.maxRuntimeMs;
      assert.ok(Number.isFinite(receipt.startedAt) && receipt.startedAt >= earliest && receipt.startedAt < latest, "Every model dispatch begins inside its original or explicitly approved continuation runtime window");
      if (receipt.reply.responseId) { assert.ok(!responseIds.has(receipt.reply.responseId)); responseIds.add(receipt.reply.responseId); }
      raw = receipt.reply.content ?? "";
    }
    let action: ReturnType<typeof parseAction> | undefined, candidate: any, invalidReason: string | undefined;
    try { action = parseAction(raw); candidate = applyAction(c.task, state.layout, action); }
    catch (error) { invalidReason = error instanceof Error ? error.message.slice(0, 512) : "Invalid action"; }
    let attempt: any;
    if (invalidReason) {
      state.invalid++; state.invalidCauses[invalidReason] = (state.invalidCauses[invalidReason] ?? 0) + 1;
      attempt = { ...(action ? { action } : { rawText: raw.slice(0, 512) }), status: "invalid", reason: invalidReason };
    } else if (action!.op === "stop") { state.stopped = true; attempt = { action, status: "stopped" }; }
    else {
      const result = score(c, arm, candidate, c.feedbackDays, `candidate-${round}`), accepted = accept(state.feedback, result);
      attempt = { action, status: accepted ? "accepted" : "rejected", feedback: result };
      if (accepted) { state.layout = candidate; state.feedback = result; state.accepted++; }
    }
    eq(attempt, event.attempt, `Action legality and acceptance ${stepKey}`);
    assert.equal(event.retainedLayoutHash, layoutHash(state.layout));
    state.history = [...state.history.slice(-2), attempt]; state.nextRound = round + 1;
    if (state.nextRound === 3 || state.stopped && !state.snapshot3) state.snapshot3 = structuredClone(state.layout);
  }
  assert.equal(searchEnded, true); assert.equal(usedRequests.size, requests.length, "No unaccounted requests");
  eq(pendingOrder, stepModelOrder, "Every dispatch matches one reconstructed action, in balanced order");
  eq(receivedOrder, pendingOrder, "Every dispatch has one resolved event");
  for (const state of states.values()) {
    const { c, arm } = state, saved: any = recordedStates.get(key(c.id, arm));
    assert.ok(state.stopped || state.nextRound === 12, "Every arm stopped explicitly or received all twelve opportunities");
    assert.ok(state.snapshot3);
    state.final = { initial: score(c, arm, c.initial, c.finalDays, "final-initial"), round3: score(c, arm, state.snapshot3, c.finalDays, "final-three"), round12: score(c, arm, state.layout, c.finalDays, "final-twelve") };
    for (const name of ["layout", "history", "feedback", "snapshot3", "accepted", "invalid", "stopped", "nextRound", "final"]) eq(state[name], saved[name], `Reconstructed final state ${c.id}/${arm}/${name}`);
  }
  assert.equal(usedSimulations.size, simulations.length, "No unaccounted simulator calls");
  const verifiedOverall: any = {}, detail: any = {};
  function comparison(left: any[], right: any[]) {
    const deltas = left.map((l, i) => l.objective - right[i].objective);
    const damageDeltas = left.map((l, i) => l.metrics.damaged - right[i].metrics.damaged);
    return { factories: cases.length, objectiveWins: deltas.filter(d => d < 0).length, objectiveLosses: deltas.filter(d => d > 0).length, objectiveTies: deltas.filter(d => d === 0).length, meanObjectiveDelta: mean(deltas), meanDamagePerDayDelta: mean(damageDeltas), damageWins: damageDeltas.filter(d => d < 0).length, damageLosses: damageDeltas.filter(d => d > 0).length, damageTies: damageDeltas.filter(d => d === 0).length };
  }
  for (const arm of ARMS) {
    const rows = cases.map(c => states.get(key(c.id, arm))), calls = requests.filter(r => r.arm === arm), sims = simulations.filter(r => r.arm === arm);
    const snapshots: any = {}, measurements: any = {};
    for (const snapshot of ["round3", "round12"]) {
      const values = rows.map(s => s.final[snapshot]), initial = rows.map(s => s.final.initial), deltas = values.map((v, i) => v.objective - initial[i].objective);
      snapshots[snapshot] = { factories: cases.length, scored: rows.length, missing: 0, zeroDamage: values.filter(zero).length, goalPasses: values.filter(v => v.goalMet).length, meanObjective: mean(values.map(v => v.objective)), meanObjectiveDelta: mean(deltas), improvements: deltas.filter(d => d < 0).length };
      measurements[snapshot] = { ...snapshots[snapshot], meanInitialObjective: mean(initial.map(v => v.objective)), objectiveReductionPercent: 100 * (mean(initial.map(v => v.objective)) - snapshots[snapshot].meanObjective) / mean(initial.map(v => v.objective)), meanMakespan: mean(values.map(v => v.metrics.makespan)), meanDamagePerDay: mean(values.map(v => v.metrics.damaged)), totalDamagedAcrossFactoryDays: values.reduce((sum, v) => sum + v.days.reduce((n: number, d: any) => n + d.metrics.damaged, 0), 0), evaluatedFactoryDays: cases.length * 4, meanMissorts: mean(values.map(v => v.metrics.missorts)), meanUnshipped: mean(values.map(v => v.metrics.unshipped)), worseThanInitial: deltas.filter(d => d > 0).length, sameAsInitial: deltas.filter(d => d === 0).length };
    }
    const summary = { label: arm === "geometric-teacher" ? "Privileged deterministic planner plus gated replay" : arm === "random" ? "Seeded legal random moves" : arm, snapshots, completedSearches: rows.length, offeredProposals: cases.length * 12, attemptedProposals: rows.reduce((sum, s) => sum + s.nextRound, 0), acceptedMoves: rows.reduce((sum, s) => sum + s.accepted, 0), invalidActions: rows.reduce((sum, s) => sum + s.invalid, 0), modelCalls: calls.length, knownTokens: calls.reduce((sum, r) => sum + r.reply.usage.totalTokens, 0), reservedUnknownTokens: 0, latencyMs: calls.reduce((sum, r) => sum + r.latencyMs, 0), replaySimulations: sims.reduce((sum, r) => sum + r.attempts * r.dayCount, 0), planningSimulations: rows.reduce((sum, s) => sum + (s.teacher?.feedbackSimulationCalls ?? 0), 0), planningMs: rows.reduce((sum, s) => sum + (s.teacherMs ?? 0), 0), planningReceipts: rows.flatMap(s => s.teacher ? [{ caseId: s.c.id, ...s.teacher }] : []) };
    eq(summary, (options.continuation?.primaryOverall ?? reported.overall)[arm], `Entire independently reconstructed aggregate ${arm}`);
    assert.ok(summary.modelCalls <= cases.length * 12 && summary.knownTokens <= plan.maxTokensPerArm && summary.replaySimulations <= plan.maxSimulationsPerArm);
    if (MODELS.includes(arm)) assert.equal(summary.modelCalls, summary.attemptedProposals);
    let cumulativeTokens = 0;
    for (const id of stepModelOrder.filter(id => requestMap.get(id).arm === arm)) {
      const r = requestMap.get(id); assert.ok(cumulativeTokens + r.reservedTokens <= plan.maxTokensPerArm, "Token cap allowed each actual dispatch"); cumulativeTokens += r.reply.usage.totalTokens;
    }
    verifiedOverall[arm] = { ...summary, planningReceipts: undefined };
    detail[arm] = { ...measurements, round12VersusRound3: comparison(rows.map(s => s.final.round12), rows.map(s => s.final.round3)), invalidCauses: rows.reduce((acc, s) => { for (const [reason, count] of Object.entries(s.invalidCauses)) acc[reason] = (acc[reason] ?? 0) + Number(count); return acc; }, {} as Record<string, number>) };
  }
  assert.ok(requests.length <= plan.maxModelCalls);
  const paired: any = {};
  for (const snapshot of ["round3", "round12"]) {
    paired[snapshot] = [];
    for (let i = 0; i < ARMS.length; i++) for (let j = i + 1; j < ARMS.length; j++) paired[snapshot].push({ left: ARMS[j], right: ARMS[i], ...comparison(cases.map(c => states.get(key(c.id, ARMS[j])).final[snapshot]), cases.map(c => states.get(key(c.id, ARMS[i])).final[snapshot])) });
  }
  assert.equal(graderHash(), GRADER);
  for (const [path, hash] of Object.entries(plan.sourceHashes)) assert.equal(hashFile(path), hash, `Source unchanged through audit ${path}`);
  const result = { status: "passed", createdAt: new Date().toISOString(), evaluation: root, planHash, graderHash: GRADER, factories: cases.length, sealedPopulation: allCases.length, excludedFactoryIds: options.continuation?.excludedIds ?? [], directSimulatorCalls, modelRequests: requests.length, duplicateIdenticalStepEvents: duplicateSteps, training, verifiedOverall, detail, paired, orderingEvidence: { feedbackOnlyPromptsVerified: true, everySearchEventPrecedesCompletionMarker: true, allSnapshotsRescoredAfterCompletion: true, limitation: "Simulation receipts contain no timestamps. Original final-scoring wall-clock order is supported by frozen source control flow and feedback-only prompt reconstruction, not independent per-simulation timing evidence." }, metricsHash: hashFile(join(root, "metrics.json")), checkpointHash: hashFile(join(root, "checkpoint.json")), requestReceiptsHash: contentHash(requests.sort((a, b) => a.id.localeCompare(b.id))), simulationReceiptsHash: contentHash(simulations.sort((a, b) => a.id.localeCompare(b.id))), fixture: Boolean(options.fixture) };
  if (options.output) { assert.ok(!existsSync(options.output), "Never overwrite prior audit evidence"); writeFileSync(options.output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); }
  return result;
}

async function selfTest() {
  const { freezeV2Evaluation, readV2Cases, runV2Evaluation } = await import("../src/training/optimizer-v2-evaluate.ts");
  const parent = resolve("runs/optimizer-eval"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, ".v2-auditor-fixture-")), data = join(root, "data"); mkdirSync(data);
  const days = (seed: number) => ["normal", "peak", "fragile", "skewed"].map((profile, i) => ({ seed: seed + i, profile, count: 100 }));
  const cases = [0, 1].map(i => { const task = generateBuilding(74890122 + i * 3211, `auditor-fixture-${i}`); return { id: task.id, split: "test", buildingId: task.id, buildingHash: buildingHash(task), geometrySeed: 74890122 + i * 3211, initialLayoutHash: layoutHash(task.initial), task, initial: task.initial, feedbackDays: days(89312001 + i * 20), finalDays: days(89312005 + i * 20) }; });
  if (existsSync("runs/optimizer-data/v2/manifest.json")) {
    const production = json("runs/optimizer-data/v2/manifest.json");
    assert.ok(cases.every(c => !production.splitBuildingHashes.test.includes(c.buildingHash)), "Auditor fixtures must not consume real sealed-test geometry");
  }
  const contents: any = { "train.jsonl": "fixture train\n", "validation.jsonl": "fixture validation\n", "test-factories.jsonl": cases.map(c => JSON.stringify(c)).join("\n") + "\n" };
  const files: any = {};
  for (const [name, text] of Object.entries(contents)) { writeFileSync(join(data, name), text as string); files[name] = { sha256: hashFile(join(data, name)), bytes: Buffer.byteLength(text as string) }; }
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ taskProfile: "optimizer", promptProfile: "factory-single-move-optimizer-v1", graderHash: GRADER, files, sourceHashes: { "src/training/optimizer.ts": hashFile("src/training/optimizer.ts") }, splitBuildingHashes: { train: [], validation: [], test: cases.map(c => c.buildingHash) }, splitDemandSeeds: { train: [], validation: [], test: cases.flatMap(c => [...c.feedbackDays, ...c.finalDays].map(d => d.seed)) } }));
  const proof: any = { schemaVersion: 2, status: "ready", baseCheckpoint: BASE, taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", models: Object.fromEntries(MODELS.map((alias, i) => [alias, { baseCheckpoint: BASE, trainingJobId: i ? `fixture-job-${i}` : null, epochs: [0, 1, 3, 1][i], taskProfile: "optimizer", promptProfile: "nemotron8b-thinking-off-v1", adapterHashes: i ? { "adapter_config.json": "e".repeat(64), "adapter_model.safetensors": String(i).repeat(64) } : null, dataset: i === 3 ? { graderHash: GRADER, files: { "train.jsonl": files["train.jsonl"].sha256, "validation.jsonl": files["validation.jsonl"].sha256 } } : i ? OLD_DATA : null }])) };
  const plan = freezeV2Evaluation({ dataDirectory: data, outputDirectory: join(root, "evaluation"), baseUrl: "http://127.0.0.1:1/v1", provenance: proof, live: true, finalEval: true, factoryLimit: 2, maxModelCalls: 96, maxTokensPerArm: 1_000_000, maxSimulationsPerArm: 128, maxRuntimeMs: 120_000, randomSeed: 81311 });
  writeFileSync(join(plan.outputDirectory, "health-receipt.json"), JSON.stringify({ planHash: contentHash(plan), health: proof }));
  const selected = readV2Cases(plan), counts: Record<string, number> = {};
  const proposed = selected.map(c => legalMoveActions(c.task, c.initial, 83155, 1)[0]);
  await runV2Evaluation(plan, selected, async request => {
    const count = counts[request.model] ?? 0; counts[request.model] = count + 1;
    const content = request.model === MODELS[0] ? "invalid JSON" : request.model === MODELS[1] ? '{"op":"stop"}' : JSON.stringify(proposed[Math.floor(count / 12)]);
    return { content, responseId: `fixture-${request.model}-${count}`, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } };
  });
  const report = auditV2Results(plan.outputDirectory, { confirmedComplete: true, fixture: true, output: join(root, "self-test-audit.json") });
  const metricsPath = join(plan.outputDirectory, "metrics.json"), original = readFileSync(metricsPath, "utf8"), corrupted = JSON.parse(original);
  corrupted.overall[MODELS[0]].snapshots.round12.meanObjective += 1; writeFileSync(metricsPath, JSON.stringify(corrupted));
  assert.throws(() => auditV2Results(plan.outputDirectory, { confirmedComplete: true, fixture: true }), /aggregate/); writeFileSync(metricsPath, original);
  const eventsPath = join(plan.outputDirectory, "events.jsonl"), originalEvents = readFileSync(eventsPath, "utf8");
  writeFileSync(eventsPath, JSON.stringify({ type: "all-searches-ended", terminalReason: null }) + "\n" + originalEvents);
  assert.throws(() => auditV2Results(plan.outputDirectory, { confirmedComplete: true, fixture: true }), /No search event/); writeFileSync(eventsPath, originalEvents);
  assert.throws(() => auditV2Results(plan.outputDirectory, { confirmedComplete: false, fixture: true }), /Explicit completion/);
  console.log(JSON.stringify({ status: "self-test-passed", directory: root, directSimulatorCalls: report.directSimulatorCalls, modelRequests: report.modelRequests, corruptionChecks: ["aggregate", "premature-completion-marker", "missing-confirmation"] }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--self-test")) await selfTest();
  else {
    const args = process.argv.slice(2), confirmedComplete = args.shift() === "--confirmed-complete", directory = args.shift(), output = args.shift();
    assert.ok(directory && output, "Usage: npx tsx scripts/audit-optimizer-v2-results.ts --confirmed-complete EVAL_DIR OUTPUT_JSON --v1 DIR --old3 DIR --v2 DIR --bundle DIR");
    const options = new Map<string, string>();
    while (args.length) { const name = args.shift()!, value = args.shift(); assert.ok(["--v1", "--old3", "--v2", "--bundle"].includes(name) && value && !options.has(name)); options.set(name, value); }
    const report = auditV2Results(directory, { confirmedComplete, output, recovered: { v1: options.get("--v1")!, old3: options.get("--old3")!, v2: options.get("--v2")! }, bundle: options.get("--bundle") });
    console.log(JSON.stringify({ status: report.status, output, factories: report.factories, directSimulatorCalls: report.directSimulatorCalls, modelRequests: report.modelRequests, detail: report.detail }, null, 2));
  }
}
