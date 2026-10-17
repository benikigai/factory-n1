import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { criticMessages, type CriticInput, type CriticOutput } from "./critic.ts";
import { buildingHash, contentHash } from "./generate.ts";

const FLAGS = ["zeroDamage", "allShipped", "goalMet"] as const;
const METRICS = ["objective", "makespan", "damaged", "missorts", "unshipped"] as const;
export type Arm = "base" | "tuned";
export interface CheckpointProvenance {
  baseModel: string;
  tunedModel: string;
  baseCheckpoint: string;
  tunedBaseCheckpoint: string;
  trainingJobId: string;
}
export interface EvaluationOptions {
  dataDirectory: string;
  outputDirectory: string;
  split: "validation" | "test";
  finalEval: boolean;
  live: boolean;
  baseModel: string;
  tunedModel: string;
  baseUrl: string;
  provenance?: CheckpointProvenance;
  limit: number;
  maxCalls: number;
  maxTotalTokens: number;
  maxOutputTokens: number;
}
export interface EvaluationCase { id: string; building: string; input: CriticInput; expected: CriticOutput }
export interface ModelReply {
  content: string | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string | null;
  responseId?: string;
}
export type ModelCall = (request: { model: string; messages: ReturnType<typeof criticMessages>; temperature: 0; maxOutputTokens: number }) => Promise<ModelReply>;
export interface Prediction { caseId: string; building: string; arm: Arm; model: string; reply?: ModelReply; error?: { code: string; status?: number }; parsed: CriticOutput | null }

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]) { return Object.keys(value).sort().join(",") === [...expected].sort().join(","); }

/** Strict schema validation counts prose, fenced JSON, extra fields, and inconsistent nulls as failures. */
export function parsePrediction(content: string | null): CriticOutput | null {
  let value: unknown;
  try { value = JSON.parse(content ?? ""); } catch { return null; }
  if (!object(value) || !keys(value, ["valid", "errors", "metrics", ...FLAGS]) || typeof value.valid !== "boolean" || !Array.isArray(value.errors) || !value.errors.every(error => typeof error === "string")) return null;
  if (!value.valid) return value.errors.length > 0 && value.metrics === null && FLAGS.every(flag => value[flag] === null) ? value as unknown as CriticOutput : null;
  const metrics = value.metrics;
  if (value.errors.length || !object(metrics) || !keys(metrics, METRICS) || !METRICS.every(metric => typeof metrics[metric] === "number" && Number.isFinite(metrics[metric]) && Number(metrics[metric]) >= 0) || !FLAGS.every(flag => typeof value[flag] === "boolean")) return null;
  return value as unknown as CriticOutput;
}

function validateOptions(options: EvaluationOptions) {
  if (options.split === "test" && !options.finalEval) throw new Error("Test access requires --final-eval; validation is the default");
  if (options.finalEval && options.split !== "test") throw new Error("--final-eval is only for the test split");
  if (!options.baseModel || !options.tunedModel || options.baseModel === options.tunedModel) throw new Error("Base and tuned model IDs must be distinct");
  for (const key of ["limit", "maxCalls", "maxTotalTokens", "maxOutputTokens"] as const) if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer`);
  if (options.maxOutputTokens > 4096) throw new Error("Critic output cap must be at most 4096 tokens");
  const url = new URL(options.baseUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Base URL must be an HTTP endpoint without credentials, query, or fragment");
  if (options.live) {
    const proof = options.provenance;
    if (!proof || proof.baseModel !== options.baseModel || proof.tunedModel !== options.tunedModel || typeof proof.baseCheckpoint !== "string" || !/(?:^|[@:])(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(proof.baseCheckpoint) || proof.baseCheckpoint !== proof.tunedBaseCheckpoint || typeof proof.trainingJobId !== "string" || !proof.trainingJobId) throw new Error("Live comparison requires matching immutable base checkpoint and adapter training provenance (commit SHA or weights SHA256)");
  }
}

/** Freeze IDs, checkpoint provenance, hashes, selection rule, and budget before opening examples. */
export function freezeEvaluation(options: EvaluationOptions) {
  validateOptions(options);
  const data = resolve(options.dataDirectory), output = resolve(options.outputDirectory);
  if (!output.startsWith(`${resolve("runs/finetune-eval")}/`) || existsSync(output)) throw new Error("Use a new output directory under runs/finetune-eval/");
  const manifestBytes = readFileSync(join(data, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestBytes);
  const splitFile = `${options.split}.jsonl`;
  const file = manifest.files?.[splitFile];
  if (manifest.schemaVersion !== 1 || !file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes)) throw new Error("Invalid dataset manifest");
  const plan = {
    schemaVersion: 1, ...options, dataDirectory: data, outputDirectory: output,
    temperature: 0, automaticRetries: 0, selection: "Round robin over sorted building hashes; rows sorted by input SHA256 within each building",
    manifestHash: contentHash(manifestBytes), datasetFile: splitFile, datasetHash: file.sha256, datasetBytes: file.bytes,
    graderHash: manifest.graderHash,
    createdAt: new Date().toISOString(),
    scope: "Paired layout critic prediction quality. Does not measure factory optimization or agent policy improvement.",
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "evaluation-plan.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return plan;
}
export type EvaluationPlan = ReturnType<typeof freezeEvaluation>;

export function isLoopbackEndpoint(baseUrl: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
}

export function validateLoopbackHealth(value: unknown, provenance: CheckpointProvenance | undefined) {
  if (!provenance || !object(value) || value.status !== "ready" || value.trainingJobId !== provenance.trainingJobId || value.baseCheckpoint !== provenance.baseCheckpoint) {
    throw new Error("Loopback server health does not match the frozen ready checkpoint and training job");
  }
  return { status: "ready" as const, trainingJobId: provenance.trainingJobId, baseCheckpoint: provenance.baseCheckpoint };
}

function assertFrozenPlan(plan: EvaluationPlan) {
  if (contentHash(JSON.stringify(JSON.parse(readFileSync(join(plan.outputDirectory, "evaluation-plan.json"), "utf8")))) !== contentHash(JSON.stringify(plan))) throw new Error("Frozen evaluation plan changed");
  validateOptions(plan);
}

export function readEvaluationCases(plan: EvaluationPlan): EvaluationCase[] {
  // Recheck the on-disk freeze so a caller cannot change flags or hashes after freezing.
  assertFrozenPlan(plan);
  if (plan.live && isLoopbackEndpoint(plan.baseUrl)) {
    const receipt = JSON.parse(readFileSync(join(plan.outputDirectory, "health-receipt.json"), "utf8"));
    if (receipt.planHash !== contentHash(plan)) throw new Error("Loopback health receipt belongs to a different plan");
    validateLoopbackHealth(receipt.health, plan.provenance);
  }
  const bytes = readFileSync(join(plan.dataDirectory, plan.datasetFile));
  if (bytes.length !== plan.datasetBytes || contentHash(bytes.toString("utf8")) !== plan.datasetHash) throw new Error("Evaluation dataset does not match frozen hash");
  const groups = new Map<string, EvaluationCase[]>();
  for (const line of bytes.toString("utf8").trim().split("\n")) {
    const row = JSON.parse(line);
    if (!Array.isArray(row.messages) || row.messages.length !== 3 || row.messages.map((message: { role: string }) => message.role).join(",") !== "system,user,assistant") throw new Error("Expected single-turn critic examples");
    const input = JSON.parse(row.messages[1].content) as CriticInput;
    const messages = criticMessages(input);
    if (JSON.stringify(messages) !== JSON.stringify(row.messages.slice(0, 2))) throw new Error("Critic prompt differs from the frozen input builder");
    const expected = parsePrediction(row.messages[2].content);
    if (!expected) throw new Error("Evaluation label is not valid critic JSON");
    const building = buildingHash({ id: "evaluation", goal: input.goal, initial: { ...input.layout, stations: input.constraints.fixedStations }, fixed: input.constraints.fixedStations.map(station => station.id), editable: { sorter: input.constraints.sorter, pack: input.constraints.pack }, capexCap: input.constraints.capexCap });
    const item = { id: contentHash(row.messages[1].content), building, input, expected };
    const group = groups.get(building) ?? []; group.push(item); groups.set(building, group);
  }
  const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows.sort((a, b) => a.id.localeCompare(b.id)));
  const selected: EvaluationCase[] = [];
  for (let index = 0; selected.length < plan.limit; index++) {
    let found = false;
    for (const group of ordered) if (group[index] && selected.length < plan.limit) { selected.push(group[index]); found = true; }
    if (!found) break;
  }
  writeFileSync(join(plan.outputDirectory, "selection.json"), JSON.stringify({ hash: contentHash(selected), cases: selected.map(item => ({ id: item.id, building: item.building })) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return selected;
}

const rate = (correct: number, total: number) => ({ correct, total, rate: total ? correct / total : null });
export function armMetrics(cases: EvaluationCase[], predictions: Prediction[]) {
  const byCase = new Map(predictions.map(prediction => [prediction.caseId, prediction]));
  const rows = cases.map(item => ({ expected: item.expected, predicted: byCase.get(item.id)?.parsed ?? null }));
  return {
    cases: rows.length,
    schemaValidity: rate(rows.filter(row => row.predicted).length, rows.length),
    validityAccuracy: rate(rows.filter(row => row.predicted?.valid === row.expected.valid).length, rows.length),
    flagAccuracy: Object.fromEntries(FLAGS.map(flag => [flag, rate(rows.filter(row => row.predicted && row.predicted[flag] === row.expected[flag]).length, rows.length)])),
    falseSafe: Object.fromEntries(FLAGS.map(flag => {
      const atRisk = rows.filter(row => row.expected[flag] !== true);
      return [flag, { falseSafe: atRisk.filter(row => row.predicted?.[flag] === true).length, atRisk: atRisk.length, rate: atRisk.length ? atRisk.filter(row => row.predicted?.[flag] === true).length / atRisk.length : null }];
    })),
    numeric: Object.fromEntries(METRICS.map(metric => {
      const eligible = rows.filter(row => row.expected.metrics), measured = eligible.filter(row => row.predicted?.metrics);
      return [metric, { mae: measured.length ? measured.reduce((sum, row) => sum + Math.abs(row.predicted!.metrics![metric] - row.expected.metrics![metric]), 0) / measured.length : null, measured: measured.length, missing: eligible.length - measured.length, eligible: eligible.length }];
    })),
  };
}

export function comparePredictions(cases: EvaluationCase[], predictions: Prediction[]) {
  const arms = { base: predictions.filter(row => row.arm === "base"), tuned: predictions.filter(row => row.arm === "tuned") };
  const byArm = { base: new Map(arms.base.map(row => [row.caseId, row])), tuned: new Map(arms.tuned.map(row => [row.caseId, row])) };
  const completed = cases.filter(item => byArm.base.has(item.id) && byArm.tuned.has(item.id));
  const categorical = { baseWins: 0, tunedWins: 0, ties: 0 };
  const numeric = { baseWins: 0, tunedWins: 0, ties: 0, eligible: 0, skipped: 0 };
  for (const item of completed) {
    const base = byArm.base.get(item.id)!.parsed, tuned = byArm.tuned.get(item.id)!.parsed;
    const score = (output: CriticOutput | null) => output ? Number(output.valid === item.expected.valid) + FLAGS.reduce((sum, flag) => sum + Number(output[flag] === item.expected[flag]), 0) : -1;
    const difference = score(tuned) - score(base);
    categorical[difference > 0 ? "tunedWins" : difference < 0 ? "baseWins" : "ties"]++;
    if (!item.expected.metrics) { numeric.skipped++; continue; }
    numeric.eligible++;
    const loss = (output: CriticOutput | null) => output?.metrics ? METRICS.reduce((sum, metric) => sum + Math.abs(output.metrics![metric] - item.expected.metrics![metric]) / Math.max(1, Math.abs(item.expected.metrics![metric])), 0) / METRICS.length : Infinity;
    const a = loss(base), b = loss(tuned);
    numeric[b < a ? "tunedWins" : b > a ? "baseWins" : "ties"]++;
  }
  return {
    scope: "Prediction quality only; no factory optimization claim.", pairedCases: completed.length, unpairedCases: cases.length - completed.length,
    definitions: {
      accuracy: "Invalid JSON/schema and absent responses are wrong; expected null flags on invalid layouts match only null.",
      falseSafe: "Schema-valid predicted true when the expected flag is false or null, divided by all cases whose expected flag is not true. Schema failures are reported separately.",
      categoricalWins: "More correct validity/zeroDamage/allShipped/goalMet fields wins; schema failure scores -1. Equal scores tie.",
      numericWins: "Lower mean absolute error normalized per metric by max(1, abs(label)) wins on valid labels. Missing numeric prediction has infinite loss; both missing tie. Invalid labels are skipped.",
      numericMAE: "Raw-unit MAE on available numeric predictions; missing and eligible counts are always reported.",
    },
    overall: { base: armMetrics(cases, arms.base), tuned: armMetrics(cases, arms.tuned) },
    byBuilding: Object.fromEntries([...new Set(cases.map(item => item.building))].sort().map(building => [building, Object.fromEntries((["base", "tuned"] as const).map(arm => [arm, armMetrics(cases.filter(item => item.building === building), arms[arm])]))])),
    pairedWins: { categorical, numeric },
  };
}

export function tokenUpperBound(messages: ReturnType<typeof criticMessages>, maxOutputTokens: number) { return Buffer.byteLength(JSON.stringify(messages), "utf8") + 4096 + maxOutputTokens; }

/** Sequential, charged-before-dispatch calls; ambiguous failures stop without retry. */
export async function runEvaluation(plan: EvaluationPlan, cases: EvaluationCase[], call: ModelCall) {
  if (!plan.live) throw new Error("Model calls require --live");
  assertFrozenPlan(plan);
  if (JSON.parse(readFileSync(join(plan.outputDirectory, "selection.json"), "utf8")).hash !== contentHash(cases)) throw new Error("Selected evaluation cases changed after freezing");
  const predictions: Prediction[] = [];
  const budget = { attempts: 0, knownTokens: 0, reservedUnknownTokens: 0 };
  let stopped: string | null = null;
  const journal = join(plan.outputDirectory, "responses.jsonl");
  if (existsSync(journal) || existsSync(join(plan.outputDirectory, "metrics.json"))) throw new Error("Evaluation already attempted; no automatic replay or retry is permitted");
  const record = (value: unknown) => appendFileSync(journal, JSON.stringify(value) + "\n", { mode: 0o600 });
  outer: for (const item of cases) {
    const messages = criticMessages(item.input);
    for (const arm of ["base", "tuned"] as const) {
      const reserve = tokenUpperBound(messages, plan.maxOutputTokens);
      if (budget.attempts >= plan.maxCalls || budget.knownTokens + budget.reservedUnknownTokens + reserve > plan.maxTotalTokens) { stopped = "budget_exhausted_before_dispatch"; break outer; }
      budget.attempts++; budget.reservedUnknownTokens += reserve;
      const model = arm === "base" ? plan.baseModel : plan.tunedModel;
      record({ type: "pending", caseId: item.id, building: item.building, arm, model, reservedTokens: reserve, attempt: budget.attempts });
      const prediction: Prediction = { caseId: item.id, building: item.building, arm, model, parsed: null };
      try {
        const reply = await call({ model, messages, temperature: 0, maxOutputTokens: plan.maxOutputTokens });
        prediction.reply = reply; prediction.parsed = parsePrediction(reply.content);
        const usage = reply.usage;
        if (!usage || ![usage.promptTokens, usage.completionTokens, usage.totalTokens].every(value => Number.isSafeInteger(value) && value >= 0) || usage.totalTokens < usage.promptTokens + usage.completionTokens) {
          prediction.error = { code: "missing_or_invalid_usage_charge_unknown" }; stopped = prediction.error.code;
        } else {
          budget.reservedUnknownTokens -= reserve; budget.knownTokens += usage.totalTokens;
          if (usage.totalTokens > reserve || usage.completionTokens > plan.maxOutputTokens) { prediction.error = { code: "provider_exceeded_reserved_token_bound" }; stopped = prediction.error.code; }
        }
      } catch (error) {
        // Provider exceptions may contain headers or keys. Keep only a numeric HTTP status.
        prediction.error = { code: "request_failed_charge_unknown", ...(object(error) && Number.isInteger(error.status) ? { status: Number(error.status) } : {}) };
        stopped = prediction.error.code;
      }
      predictions.push(prediction);
      record({ type: "response", ...prediction, budget: { ...budget } });
      if (stopped) break outer;
    }
  }
  const report = { completed: stopped === null, stopped, budget, ...comparePredictions(cases, predictions) };
  writeFileSync(join(plan.outputDirectory, "metrics.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return report;
}
