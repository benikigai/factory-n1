import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { graderHash } from "../src/sim/version.ts";
import { CrusoeTrainingApi, INTELLIGENCE_URL, readTrainingSplit, selectTrainingModel, sha256, trainingRequest, validationDetails, type TrainingModel } from "../src/training/crusoe-api.ts";

const model: TrainingModel = { id: "ftmodel-exact", model_name: "crusoeai/NVIDIA-Nemotron-3.5-Nano-30B-A3B-BF16-07292026", model_revision: "main", fine_tuning_available: true, inference_available: false, model_type: "base_model" };
const file = (id: string) => ({ id, bytes: 23, filename: `${id}.jsonl`, purpose: "fine-tune" });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("fine-tuning chooses the exact registry id and preserves internal model names", async () => {
  const api = new CrusoeTrainingApi("fixture-key", async (url, options) => {
    assert.equal(url, `${INTELLIGENCE_URL}/models?model_type=base_model`);
    assert.equal(options?.method, "GET");
    return response({ data: [model] });
  });
  const models = await api.models();
  assert.equal(selectTrainingModel(models, model.id).model_name, model.model_name);
  assert.equal(selectTrainingModel(models, model.model_name).id, model.id);
  assert.throws(() => selectTrainingModel(models, "nvidia/missing"), /Exact training model/);
  assert.throws(() => selectTrainingModel([{ ...model, fine_tuning_available: false }], model.id), /not a fine-tuning/);
});

test("training request pins one epoch, exact model, explicit validation and conservative parameters", () => {
  const body = trainingRequest(model, file("train"), file("validation"));
  assert.equal(body.model, "ftmodel-exact");
  assert.equal(body.method.supervised.hyperparameters.n_epochs, 1);
  assert.equal(body.validation_file, "validation");
  assert.equal(body.method.supervised.hyperparameters.overlong_row_behavior, "error");
  assert.throws(() => trainingRequest(model, file("train"), file("train")), /Distinct/);
});

test("uploads use multipart fine-tune purpose without a hand-written boundary", async () => {
  let calls = 0;
  const api = new CrusoeTrainingApi("fixture-key", async (url, options) => {
    calls++;
    assert.equal(url, `${INTELLIGENCE_URL}/files`);
    assert.equal(options?.method, "POST");
    assert.ok(options?.body instanceof FormData);
    assert.equal(options.body.get("purpose"), "fine-tune");
    assert.equal(new Headers(options.headers).get("Content-Type"), null);
    assert.equal(options.redirect, "error");
    return response(file("train"));
  });
  assert.equal((await api.upload("train.jsonl", Buffer.from("data"))).id, "train");
  assert.equal(calls, 1);
});

test("estimate accepts official decimal-string price and remains explicitly nonbinding", async () => {
  const api = new CrusoeTrainingApi("fixture-key", async (url, options) => {
    assert.equal(url, `${INTELLIGENCE_URL}/fine_tuning/jobs/estimate_price`);
    assert.equal(JSON.parse(String(options?.body)).model, model.id);
    return response({ object: "fine_tuning.job.price_estimate", estimated_price: "0.42", currency: "usd" });
  });
  assert.deepEqual(await api.estimate(trainingRequest(model, file("train"), file("validation"))), { estimatedUsd: 0.42, currency: "usd", isHardCap: false });
});

test("transport and server failures never retry or expose keys and error bodies", async () => {
  for (const kind of ["network", "http"] as const) {
    let calls = 0;
    const api = new CrusoeTrainingApi("SECRET", async () => {
      calls++;
      if (kind === "network") throw new Error("SECRET raw request headers");
      return response({ error: "SECRET raw provider body" }, 500);
    });
    await assert.rejects(api.train(trainingRequest(model, file("train"), file("validation"))), error => {
      assert.doesNotMatch(String(error), /SECRET|headers|provider body/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("422 diagnostics retain only bounded location/message/type and redact credentials", async () => {
  const diagnostic = { detail: [{ loc: ["body", "method", "supervised", "hyperparameters", "lora_rank"], msg: "Expected integer, got SECRET", type: "int_type", input: { api_key: "NEVER-KEEP-INPUT" }, ctx: { secret: "NEVER-KEEP-CONTEXT" } }] };
  assert.deepEqual(validationDetails(diagnostic, "SECRET"), [{ loc: ["body", "method", "supervised", "hyperparameters", "lora_rank"], msg: "Expected integer, got [redacted]", type: "int_type" }]);
  const api = new CrusoeTrainingApi("SECRET", async () => response(diagnostic, 422));
  await assert.rejects(api.estimate(trainingRequest(model, file("train"), file("validation"))), error => {
    assert.match(String(error), /lora_rank/);
    assert.doesNotMatch(String(error), /SECRET|NEVER-KEEP/);
    return true;
  });
});

test("training JSONL validates frozen hash, roles, duplicate rows and assistant content", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-finetune-"));
  try {
    const path = join(dir, "train.jsonl");
    const good = JSON.stringify({ messages: [{ role: "system", content: "Classify." }, { role: "user", content: "Layout." }, { role: "assistant", content: '{"valid":true}' }] }) + "\n";
    writeFileSync(path, good);
    assert.equal(readTrainingSplit(path, { sha256: sha256(good), bytes: Buffer.byteLength(good) }).rows, 1);
    assert.throws(() => readTrainingSplit(path, { sha256: "wrong", bytes: Buffer.byteLength(good) }), /frozen manifest/);
    writeFileSync(path, good + good);
    assert.throws(() => readTrainingSplit(path, { sha256: sha256(good + good), bytes: Buffer.byteLength(good + good) }), /Duplicate/);
    const bad = JSON.stringify({ messages: [{ role: "system", content: "x" }, { role: "user", content: "y" }, { role: "tool", content: "z" }] });
    writeFileSync(path, bad);
    assert.throws(() => readTrainingSplit(path, { sha256: sha256(bad), bytes: Buffer.byteLength(bad) }), /Invalid training message/);
  } finally { rmSync(dir, { recursive: true }); }
});

test("operator CLI requires approval, reuses uploads, and never duplicates a submitted job", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-finetune-cli-"));
  const repo = resolve(import.meta.dirname, "..");
  const data = join(dir, "runs/finetune-data/critic-v1");
  mkdirSync(data, { recursive: true });
  const sample = (name: string) => JSON.stringify({ messages: [{ role: "system", content: "Classify" }, { role: "user", content: name }, { role: "assistant", content: '{"valid":true}' }] }) + "\n";
  const files = Object.fromEntries(["train", "validation"].map(name => {
    const content = sample(name);
    writeFileSync(join(data, `${name}.jsonl`), content);
    return [`${name}.jsonl`, { sha256: sha256(content), bytes: Buffer.byteLength(content) }];
  }));
  writeFileSync(join(data, "manifest.json"), JSON.stringify({ schemaVersion: 1, graderHash: graderHash(), files }));
  const remote = join(dir, "remote.json");
  const preload = join(dir, "mock.mjs");
  writeFileSync(preload, `import { readFileSync,writeFileSync,existsSync } from 'node:fs';
const path=${JSON.stringify(remote)};
globalThis.fetch=async(url,opts={})=>{
const state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{requests:[],files:{}};
const p=new URL(url).pathname; const method=opts.method||'GET'; state.requests.push(method+' '+p);
let result;
if(p==='/v1/models')result={data:[${JSON.stringify(model)}]};
else if(p==='/v1/files'&&method==='POST'){const f=opts.body.get('file');result={id:'file-'+f.name,bytes:f.size,filename:f.name,purpose:'fine-tune'};state.files[result.id]=result;}
else if(p.startsWith('/v1/files/'))result=state.files[p.split('/').at(-1)];
else if(p.endsWith('/estimate_price'))result={estimated_price:'0.42',currency:'usd'};
else if(p==='/v1/fine_tuning/jobs'&&method==='POST')result={id:'job-1',status:'queued',model:'ftmodel-exact'};
else if(p==='/v1/fine_tuning/jobs/job-1')result={id:'job-1',status:'succeeded',model:'ftmodel-exact',fine_tuned_model:'adapter-1'};
else throw Error('Unexpected mocked route');
writeFileSync(path,JSON.stringify(state));return new Response(JSON.stringify(result),{status:200});
};`);
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", join(repo, "node_modules/tsx/dist/loader.mjs"), "--import", preload, join(repo, "scripts/crusoe-finetune.ts"), ...args], {
    cwd: dir, env: { ...process.env, CRUSOE_API_KEY: "fake-test-key" }, encoding: "utf8", timeout: 20_000,
  });
  const requests = () => existsSync(remote) ? JSON.parse(readFileSync(remote, "utf8")).requests as string[] : [];
  try {
    assert.notEqual(run().status, 0);
    assert.equal(requests().length, 0);
    assert.notEqual(run("train", "--model", model.id).status, 0);
    assert.equal(requests().filter(p => p.startsWith("POST")).length, 0);
    assert.equal(run("estimate", "--model", model.id).status, 0);
    assert.equal(run("estimate", "--model", model.id).status, 0);
    assert.equal(requests().filter(p => p === "POST /v1/files").length, 2);
    assert.notEqual(run("train", "--model", model.id, "--approved-usd", "0.01", "--ack-estimate-not-cap").status, 0);
    assert.equal(requests().filter(p => p === "POST /v1/fine_tuning/jobs").length, 0);
    assert.equal(run("train", "--model", model.id, "--approved-usd", "1", "--ack-estimate-not-cap").status, 0);
    const reused = run("train", "--model", model.id, "--approved-usd", "1", "--ack-estimate-not-cap");
    assert.equal(reused.status, 0);
    assert.match(reused.stdout, /"reused": true/);
    assert.equal(requests().filter(p => p === "POST /v1/fine_tuning/jobs").length, 1);
  } finally { rmSync(dir, { recursive: true }); }
});
