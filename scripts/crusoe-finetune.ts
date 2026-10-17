import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CrusoeTrainingApi, INTELLIGENCE_URL, readTrainingSplit, selectTrainingModel, sha256, trainingRequest, type TrainingFile, type TrainingRequest } from "../src/training/crusoe-api.ts";
import { graderHash } from "../src/sim/version.ts";

const HELP = `Usage: node --env-file=<1Password mount> --import tsx scripts/crusoe-finetune.ts <inspect|estimate|train|status|cancel> [options]
  --data runs/finetune-data/critic-v1  Frozen dataset directory
  --model MODEL                     Exact catalog model_name or registry ID (required except inspect)
  --approved-usd AMOUNT              Required for train; rejects a higher estimate
  --ack-estimate-not-cap             Required for train; actual billed tokens may differ
  --job ID                          Optional for status/cancel; otherwise reads saved job
inspect only reads the catalog. estimate uploads train/validation and obtains a nonbinding estimate.
train is never the default and never creates a deployment. Held-out test files are never uploaded.
Ambiguous mutations are recorded before dispatch and never automatically retried.`;

const args = process.argv.slice(2);
if (args.includes("--help")) { console.log(HELP); process.exit(0); }
const mode = args.shift();
if (!mode || !["inspect", "estimate", "train", "status", "cancel"].includes(mode)) throw new Error(HELP);
const values = new Map<string, string>();
let acknowledged = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ack-estimate-not-cap") { if (acknowledged) throw new Error("Repeated acknowledgement"); acknowledged = true; continue; }
  if (!["--data", "--model", "--approved-usd", "--job"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) throw new Error("Unknown, repeated or incomplete argument; use --help");
  values.set(args[i], args[++i]);
}
const data = resolve(values.get("--data") ?? "runs/finetune-data/critic-v1");
if (!data.startsWith(`${resolve("runs/finetune-data")}/`)) throw new Error("Dataset receipts must remain under runs/finetune-data/");
const output = join(data, "crusoe");
const load = (name: string) => JSON.parse(readFileSync(join(output, name), "utf8"));
const save = (name: string, value: unknown) => {
  mkdirSync(output, { recursive: true });
  const temporary = join(output, `.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, join(output, name));
};

async function main() {
  const api = new CrusoeTrainingApi(process.env.CRUSOE_API_KEY ?? "");
  if (mode === "status" || mode === "cancel") {
    const id = values.get("--job") ?? load("job.json").job?.id;
    if (typeof id !== "string" || !id) throw new Error("No saved job; pass --job ID");
    const job = mode === "status" ? await api.status(id) : await api.cancel(id);
    save(`${mode}.json`, { at: new Date().toISOString(), job });
    console.log(JSON.stringify(job, null, 2));
    return;
  }
  const models = await api.models();
  const candidates = models.filter(m => m.fine_tuning_available && /nemotron/i.test(m.model_name));
  if (mode === "inspect" && !values.has("--model")) {
    const receipt = { at: new Date().toISOString(), baseUrl: INTELLIGENCE_URL, fineTuningNemotronModels: candidates };
    save("catalog.json", receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  if (!values.has("--model")) throw new Error("Pass --model with an exact registry ID from inspect");
  const model = selectTrainingModel(models, values.get("--model")!);
  save("catalog.json", { at: new Date().toISOString(), baseUrl: INTELLIGENCE_URL, model,
    fineTuningNemotronModels: candidates });
  if (mode === "inspect") { console.log(JSON.stringify({ baseUrl: INTELLIGENCE_URL, model }, null, 2)); return; }
  const manifest = JSON.parse(readFileSync(join(data, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.graderHash !== graderHash()) throw new Error("Dataset grader manifest mismatch");
  const train = readTrainingSplit(join(data, "train.jsonl"), manifest.files["train.jsonl"]);
  const validation = readTrainingSplit(join(data, "validation.jsonl"), manifest.files["validation.jsonl"]);
  if ([...train.rowHashes].some(hash => validation.rowHashes.has(hash))) throw new Error("Training/validation overlap");

  async function uploaded(name: "train" | "validation", split: typeof train): Promise<TrainingFile> {
    const receiptName = `upload-${name}.json`;
    const hash = sha256(split.bytes);
    if (existsSync(join(output, receiptName))) {
      const receipt = load(receiptName);
      if (receipt.sha256 !== hash) throw new Error("Saved upload does not match current dataset; use a new dataset directory");
      if (receipt.state !== "complete") throw new Error("Previous upload outcome is unknown; reconcile it in Crusoe before retrying");
      const file = await api.retrieveFile(receipt.file.id);
      if (file.bytes !== split.bytes.length || file.purpose !== "fine-tune") throw new Error("Saved remote file metadata changed");
      return file;
    }
    save(receiptName, { state: "pending", at: new Date().toISOString(), sha256: hash, bytes: split.bytes.length });
    const file = await api.upload(`${name}.jsonl`, split.bytes);
    if (file.bytes !== split.bytes.length || file.purpose !== "fine-tune") throw new Error("Uploaded file metadata did not match dataset");
    save(receiptName, { state: "complete", at: new Date().toISOString(), sha256: hash, rows: split.rows, file });
    return file;
  }
  if (mode === "train") {
    const approved = Number(values.get("--approved-usd"));
    if (!acknowledged || !values.has("--approved-usd") || !Number.isFinite(approved) || approved <= 0) throw new Error("train requires --approved-usd and --ack-estimate-not-cap from an explicit user approval");
    // Training must consume a previously reviewed estimate; it never uploads as a side effect.
    if (!existsSync(join(output, "estimate.json"))) throw new Error("Run estimate and review its receipt before training");
    for (const name of ["train", "validation"]) if (!existsSync(join(output, `upload-${name}.json`))) throw new Error("Missing reviewed upload receipt");
  }
  const trainFile = await uploaded("train", train), validationFile = await uploaded("validation", validation);
  const request: TrainingRequest = trainingRequest(model, trainFile, validationFile);
  const requestHash = sha256(JSON.stringify(request));
  if (mode === "estimate") {
    const estimate = await api.estimate(request);
    const receipt = { at: new Date().toISOString(), requestHash, request, model, estimate, trainRows: train.rows, validationRows: validation.rows,
      warning: "Nonbinding provider estimate. Actual trained-token billing may differ. No job or deployment was created." };
    save("estimate.json", receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  const estimate = load("estimate.json");
  if (estimate.requestHash !== requestHash || JSON.stringify(estimate.model) !== JSON.stringify(model) || estimate.estimate?.isHardCap !== false || !Number.isFinite(estimate.estimate?.estimatedUsd)) throw new Error("Estimate does not match this exact training request and model revision");
  const approvedUsd = Number(values.get("--approved-usd"));
  if (estimate.estimate.estimatedUsd > approvedUsd) throw new Error("Provider estimate exceeds approved amount; training not started");
  if (existsSync(join(output, "job.json"))) {
    const receipt = load("job.json");
    if (receipt.requestHash !== requestHash) throw new Error("Saved job uses a different training request");
    if (receipt.state !== "complete") throw new Error("Previous create-job outcome is unknown; reconcile the job list before retrying");
    console.log(JSON.stringify({ reused: true, job: await api.status(receipt.job.id) }, null, 2));
    return;
  }
  save("job.json", { state: "pending", at: new Date().toISOString(), requestHash, request, approvedUsd, estimate: estimate.estimate });
  const job = await api.train(request);
  save("job.json", { state: "complete", at: new Date().toISOString(), requestHash, request, approvedUsd, estimate: estimate.estimate, job });
  console.log(JSON.stringify({ job, note: "No inference deployment was created." }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Fine-tuning command failed"); process.exitCode = 1; });
