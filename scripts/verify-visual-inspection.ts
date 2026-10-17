// Offline verification of recorded vision, tool, usage and grader evidence. Never calls a provider.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInspectionTools } from "../src/inspection/tools.ts";
import { parseInspectionAnswer, verifyFindings } from "../src/inspection/inspect.ts";
import { graderHash } from "../src/sim/version.ts";
import { loadTask, type FactoryId } from "../src/tasks/task.ts";
import type { ReplayBundle } from "../src/replay.ts";
import type { VisualInspection } from "../src/inspection/types.ts";

const dir = "recorded/live-a-11/inspection";
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const artifact = load(`${dir}/inspection.json`) as VisualInspection;
const training = load(`${dir}/training-record.json`);
const replay = load("recorded/live-a-11/replay.json") as ReplayBundle;
const hash = graderHash();
assert.equal(hash, artifact.graderHash); assert.equal(hash, replay.graderHash); assert.equal(hash, training.graderHash);
const imageHash = createHash("sha256").update(readFileSync(`${dir}/${artifact.frames[0].path}`)).digest("hex");
assert.equal(imageHash, artifact.imageInput.imageSha256); assert.equal(imageHash, training.imageSha256);
const expected = artifact.imageInput.challenge!.expected;
// Check that neither user nor system text gives away the image-only challenge.
for (const message of training.messages) {
  if (message.role !== "user" && message.role !== "system") continue;
  const text = typeof message.content === "string" ? message.content : message.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
  assert.equal(text.includes(expected), false);
}
const finalMessage = training.messages.filter((m: any) => m.role === "assistant").at(-1);
const answer = parseInspectionAnswer(finalMessage.content);
assert.equal(answer.imageCheck.trim(), expected); assert.equal(artifact.imageInput.verified, true);
assert.deepEqual(verifyFindings(answer, artifact.toolReceipts), artifact.findings);
const tools = createInspectionTools({ task: loadTask(replay.task.id as FactoryId), baseline: replay.baseline.layout, champion: replay.improved.layout, runId: replay.runId, expectedGraderHash: hash });
for (const receipt of artifact.toolReceipts) {
  assert.equal(receipt.status, "ok");
  const tool = tools.find(t => t.definition.function.name === receipt.name)!;
  assert.ok(tool);
  assert.deepEqual(await tool.execute(tool.parse(receipt.input)), receipt.output);
  const request = training.messages.flatMap((m: any) => m.tool_calls ?? []).find((t: any) => t.id === receipt.id);
  assert.equal(request.function.name, receipt.name); assert.deepEqual(JSON.parse(request.function.arguments), receipt.input);
  const response = training.messages.find((m: any) => m.role === "tool" && m.tool_call_id === receipt.id);
  assert.deepEqual(JSON.parse(response.content), receipt.output);
}
assert.equal(graderHash(), hash);
const proof = { verifiedAt: new Date().toISOString(), runId: replay.runId, model: artifact.model, imageSha256: imageHash, graderHash: hash,
  markerOmittedFromText: true, markerMatched: true, receiptsRecomputedDeepEqual: artifact.toolReceipts.length,
  supportedNumericFindings: artifact.findings.filter(f => f.verification.status === "supported").length,
  finalSplitUsed: false, usage: artifact.budget, scope: "Recorded post-run inspection; no layout edits, no fine-tuning, no causal or fresh-factory claim." };
writeFileSync("docs/evidence/visual-inspector-verification.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify(proof));
