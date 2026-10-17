import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const INTELLIGENCE_URL = "https://api.intelligence.crusoecloud.com/v1";
export const TRAINING_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export interface TrainingModel {
  id: string;
  model_name: string;
  model_revision: string | null;
  fine_tuning_available: boolean;
  inference_available: boolean;
  model_type: string | null;
}
export interface TrainingFile { id: string; bytes: number; filename: string; purpose: string }
export interface TrainingJob {
  id: string; status: string; model: string; fine_tuned_model: string | null;
  trained_tokens: number | null; created_at: number | null; finished_at: number | null;
}
export interface TrainingRequest {
  model: string; training_file: string; validation_file: string; suffix: string; seed: number;
  method: { type: "supervised"; supervised: { hyperparameters: {
    n_epochs: 1; batch_size: 16; learning_rate: number; lora_rank: 8; lora_alpha: 16;
    lora_variant: "lora"; checkpoint_steps: 20; eval_steps_per_epoch: 1; overlong_row_behavior: "error";
  } } };
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Crusoe returned an invalid object");
  return v as Record<string, unknown>;
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || !v || v.length > 1024) throw new Error("Crusoe returned an invalid identifier");
  return v;
};
const numberOrNull = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

export interface ValidationDetail { loc: (string | number)[]; msg: string; type: string }
/** FastAPI validation diagnostics only. Never retain input, ctx, headers or an arbitrary error body. */
export function validationDetails(value: unknown, secret: string): ValidationDetail[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).detail)) return [];
  const clean = (value: string, max: number) => value.split(secret).join("[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|crusoe)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/[\r\n\t]/g, " ").slice(0, max);
  return ((value as Record<string, unknown>).detail as unknown[]).slice(0, 12).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const detail = item as Record<string, unknown>;
    if (!Array.isArray(detail.loc) || typeof detail.msg !== "string" || typeof detail.type !== "string") return [];
    const loc = detail.loc.slice(0, 12).map(part => typeof part === "number" && Number.isInteger(part) ? part : typeof part === "string" ? clean(part, 80) : "?");
    return [{ loc, msg: clean(detail.msg, 240), type: clean(detail.type, 80) }];
  });
}

export function selectTrainingModel(models: TrainingModel[], requested = TRAINING_MODEL): TrainingModel {
  const matches = models.filter(model => model.id === requested || model.model_name.toLowerCase() === requested.toLowerCase());
  if (matches.length !== 1) throw new Error("Exact training model was not uniquely present in the catalog; use its registry ID");
  const model = matches[0];
  if (!model.fine_tuning_available || !/nemotron/i.test(model.model_name) || model.model_type === "adapter") {
    throw new Error("Selected model is not a fine-tuning-enabled Nemotron base model");
  }
  return model;
}

export function trainingRequest(model: TrainingModel, train: TrainingFile, validation: TrainingFile): TrainingRequest {
  if (!model.fine_tuning_available || !/nemotron/i.test(model.model_name) || model.model_type === "adapter") throw new Error("Unsupported training model");
  if (train.purpose !== "fine-tune" || validation.purpose !== "fine-tune" || train.id === validation.id) throw new Error("Distinct training and validation files are required");
  return {
    model: model.id, training_file: train.id, validation_file: validation.id,
    suffix: "factory-layout-critic-v1", seed: 20261017,
    method: { type: "supervised", supervised: { hyperparameters: {
      n_epochs: 1, batch_size: 16, learning_rate: 0.0001, lora_rank: 8, lora_alpha: 16,
      lora_variant: "lora", checkpoint_steps: 20, eval_steps_per_epoch: 1, overlong_row_behavior: "error",
    } } },
  };
}

/** Only the two development files are eligible for upload; held-out test labels remain local. */
export function readTrainingSplit(path: string, expected: { sha256: string; bytes: number }) {
  const bytes = readFileSync(path);
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error("Dataset does not match its frozen manifest");
  if (!bytes.length || bytes.length > 512 * 1024 * 1024) throw new Error("Dataset must be nonempty and at most 512 MiB");
  const rows = bytes.toString("utf8").trim().split("\n");
  const rowHashes = new Set<string>();
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try { parsed = record(JSON.parse(row)); } catch { throw new Error("Dataset contains invalid JSONL"); }
    if (!Array.isArray(parsed.messages) || parsed.messages.length !== 3) throw new Error("Expected single-turn system/user/assistant training examples");
    for (const [i, value] of parsed.messages.entries()) {
      const message = record(value);
      if (message.role !== ["system", "user", "assistant"][i] || typeof message.content !== "string" || !message.content) throw new Error("Invalid training message");
    }
    const hash = sha256(JSON.stringify(parsed.messages));
    if (rowHashes.has(hash)) throw new Error("Duplicate training example");
    rowHashes.add(hash);
  }
  return { bytes, rows: rows.length, rowHashes };
}

/** No SDK retries, error bodies, headers, or keys are exposed in receipts or thrown errors. */
export class CrusoeTrainingApi {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {
    if (!apiKey) throw new Error("CRUSOE_API_KEY is required");
  }
  private async request(path: string, method = "GET", body?: FormData | object): Promise<unknown> {
    const multipart = body instanceof FormData;
    let response: Response;
    try {
      response = await this.fetcher(`${INTELLIGENCE_URL}${path}`, {
        method, headers: { Authorization: `Bearer ${this.apiKey}`, ...(body && !multipart ? { "Content-Type": "application/json" } : {}) },
        body: body ? multipart ? body : JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90_000), redirect: "error",
      });
    } catch { throw new Error(`Crusoe ${method} request failed; outcome may be unknown. No automatic retry was made.`); }
    if (!response.ok) {
      let details: ValidationDetail[] = [];
      if (response.status === 422) {
        try { details = validationDetails(await response.json(), this.apiKey); } catch { /* No structured validation diagnostic. */ }
      }
      throw new Error(`Crusoe ${method} request failed with HTTP ${response.status}; no automatic retry was made.${details.length ? ` Validation: ${JSON.stringify(details)}` : ""}`);
    }
    try { return await response.json(); } catch { throw new Error("Crusoe returned invalid JSON; outcome may be unknown"); }
  }
  async models(): Promise<TrainingModel[]> {
    const response = record(await this.request("/models?model_type=base_model"));
    if (!Array.isArray(response.data)) throw new Error("Crusoe catalog did not contain models");
    return response.data.map(value => {
      const model = record(value);
      return { id: text(model.id), model_name: text(model.model_name ?? model.id), model_revision: typeof model.model_revision === "string" ? model.model_revision : null,
        fine_tuning_available: model.fine_tuning_available === true, inference_available: model.inference_available === true,
        model_type: typeof model.model_type === "string" ? model.model_type : null };
    });
  }
  private file(value: unknown): TrainingFile {
    const file = record(value);
    if (!Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0) throw new Error("Crusoe returned invalid file metadata");
    return { id: text(file.id), bytes: Number(file.bytes), filename: text(file.filename), purpose: text(file.purpose) };
  }
  async upload(filename: string, bytes: Buffer): Promise<TrainingFile> {
    const body = new FormData();
    body.append("purpose", "fine-tune");
    body.append("file", new Blob([new Uint8Array(bytes)], { type: "application/jsonl" }), filename);
    return this.file(await this.request("/files", "POST", body));
  }
  async retrieveFile(id: string) { return this.file(await this.request(`/files/${encodeURIComponent(id)}`)); }
  async estimate(body: TrainingRequest) {
    const value = record(await this.request("/fine_tuning/jobs/estimate_price", "POST", body));
    const usd = Number(value.estimated_price);
    if (!["number", "string"].includes(typeof value.estimated_price) || String(value.currency).toLowerCase() !== "usd" || !Number.isFinite(usd) || usd < 0 || String(value.estimated_price).trim() === "") throw new Error("Crusoe returned an invalid USD estimate");
    return { estimatedUsd: usd, currency: "usd" as const, isHardCap: false as const };
  }
  private job(value: unknown): TrainingJob {
    const job = record(value);
    return { id: text(job.id), status: text(job.status), model: text(job.model), fine_tuned_model: typeof job.fine_tuned_model === "string" ? job.fine_tuned_model : null,
      trained_tokens: numberOrNull(job.trained_tokens), created_at: numberOrNull(job.created_at), finished_at: numberOrNull(job.finished_at) };
  }
  async train(body: TrainingRequest) { return this.job(await this.request("/fine_tuning/jobs", "POST", body)); }
  async status(id: string) { return this.job(await this.request(`/fine_tuning/jobs/${encodeURIComponent(id)}`)); }
  async cancel(id: string) { return this.job(await this.request(`/fine_tuning/jobs/${encodeURIComponent(id)}/cancel`, "POST")); }
}
