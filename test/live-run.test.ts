import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findForbidden } from "../scripts/static-guard.ts";
import { isLocalRequest, latestResumable, liveCaps, nextRunId, PRESETS, resumeInfo } from "../web/live-runner.ts";

const req = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers }) as never;

test("run API accepts only same-machine, same-site requests", () => {
  const local = { host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin" };
  assert.equal(isLocalRequest(req("127.0.0.1", local), "POST"), true);
  assert.equal(isLocalRequest(req("::1", { host: "127.0.0.1:5173" }), "GET"), true);
  assert.equal(isLocalRequest(req("192.168.1.20", local), "POST"), false, "LAN peer");
  assert.equal(isLocalRequest(req("127.0.0.1", { ...local, host: "evil.example:5173" }), "POST"), false, "DNS rebinding");
  assert.equal(isLocalRequest(req("127.0.0.1", { ...local, origin: "https://evil.example" }), "POST"), false, "cross-site POST");
  assert.equal(isLocalRequest(req("127.0.0.1", { host: "localhost:5173" }), "POST"), false, "POST without Origin");
  assert.equal(isLocalRequest(req("127.0.0.1", { ...local, "sec-fetch-site": "cross-site" }), "GET"), false);
});

test("every live run gets explicit caps, clamped to the ceiling", () => {
  assert.deepEqual(liveCaps({}), { calls: 70, usd: 0.1 });
  assert.deepEqual(liveCaps({ FACTORY_LIVE_CALLS: "999", FACTORY_LIVE_USD: "5" }), { calls: 200, usd: 0.3 });
  assert.deepEqual(liveCaps({ FACTORY_LIVE_CALLS: "nope" }), { calls: 70, usd: 0.1 });
  assert.equal(PRESETS.continue.env.START_FROM_RUN, "live-a-7");
});

test("run ids count up from existing live-demo runs and logs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fn1-runs-"));
  assert.equal(nextRunId(dir), "live-demo-1");
  mkdirSync(path.join(dir, "live-demo-2"));
  writeFileSync(path.join(dir, "live-demo-4.log"), "");
  assert.equal(nextRunId(dir), "live-demo-5");
});

test("static guard flags live-run code but ignores recorded data", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fn1-dist-"));
  writeFileSync(path.join(dir, "index.html"), "<script src=app.js></script>");
  writeFileSync(path.join(dir, "app.js"), "console.log('replay only')");
  mkdirSync(path.join(dir, "runs"));
  writeFileSync(path.join(dir, "runs", "notes.js"), "child_process");
  assert.deepEqual(findForbidden(dir), []);
  writeFileSync(path.join(dir, "leak.js"), "fetch('/api/run/status')");
  assert.deepEqual(findForbidden(dir), ["leak.js: /api/run"]);
});

test("resume: only a stopped live-demo run with a launch record and checkpoint, from its checkpoint generation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fn1-resume-"));
  const record = { preset: "continue", caps: { calls: 70, usd: 0.1 }, startedAt: "2026-10-17T22:00:00Z", resumes: [] };
  const run = (id: string, files: Record<string, unknown>, withRecord = true) => {
    mkdirSync(path.join(dir, id));
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, id, name), JSON.stringify(body));
    if (withRecord) writeFileSync(path.join(dir, `${id}.live.json`), JSON.stringify(record));
  };
  run("live-demo-1", { "checkpoint.json": { state: { generation: 3, finished: true } }, "summary.json": {} });
  run("live-demo-2", { "checkpoint.json": { state: { generation: 1, finished: false } } });
  run("live-demo-3", {}, true);
  run("live-demo-4", { "checkpoint.json": { state: { generation: 2, finished: false } } }, false);

  assert.match(String((resumeInfo(dir, "live-demo-1") as { error: string }).error), /already finished/);
  const ok = resumeInfo(dir, "live-demo-2");
  assert.ok(ok.ok && ok.fromGeneration === 1 && ok.record.preset === "continue" && ok.record.caps.calls === 70);
  assert.match(String((resumeInfo(dir, "live-demo-3") as { error: string }).error), /before its first checkpoint/);
  assert.match(String((resumeInfo(dir, "live-demo-4") as { error: string }).error), /no launch record/);
  assert.match(String((resumeInfo(dir, "live-a-7") as { error: string }).error), /Only live-demo runs/);
  // Only the newest unfinished run is offered; launch records count when numbering new runs.
  assert.equal(latestResumable(dir), null, "newest run (4) has no launch record, so nothing is offered");
  writeFileSync(path.join(dir, "live-demo-4.live.json"), JSON.stringify(record));
  assert.deepEqual(latestResumable(dir), { runId: "live-demo-4", fromGeneration: 2 });
  assert.equal(nextRunId(dir), "live-demo-5");
});
