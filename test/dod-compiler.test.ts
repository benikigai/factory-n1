import assert from "node:assert/strict";
import test from "node:test";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { AUDITOR_MODEL } from "../src/agents/auditor.ts";
import { PLANNER_MODEL, type GoalChat } from "../src/agents/planner.ts";
import { compileGoal } from "../src/dod/compiler.ts";
import { assertApprovedDoD, hashDoD, sealDoD, tighteningErrors } from "../src/dod/lattice.ts";
import { DEFINITION_SCHEMA, definitionErrors, withFloors } from "../src/dod/schema.ts";
import { physicalBounds, assessFeasibility } from "../src/dod/feasibility.ts";
import { DEFAULT_DOD, FLOOR_CHECKS, type DefinitionOfDone } from "../src/sim/dod.ts";
import { simulate } from "../src/sim/engine.ts";
import { makeScenario, scenariosFor } from "../src/sim/scenarios.ts";
import { loadTaskA } from "../src/tasks/task.ts";
import { readFileSync } from "node:fs";
import type { Layout } from "../src/sim/types.ts";

const task = loadTaskA();
const scenarios = scenariosFor("train");
const goal = DEFAULT_DOD.goal;
const audit = { verdict: "approve", reasons: ["All requested thresholds and every-scenario scope are preserved."] };
function mocked(...replies: (unknown | Error)[]) {
  const calls: { agent: string; model: string; messages: unknown }[] = [];
  const call: GoalChat = async (agent, params) => {
    calls.push({ agent, model: params.model, messages: params.messages });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    assert.notEqual(next, undefined, "unexpected model call");
    return { choices: [{ message: { role: "assistant", content: typeof next === "string" ? next : JSON.stringify(next) } }] } as ChatCompletion;
  };
  return { call, calls };
}

test("one-line goal compiles with two distinct exact model IDs and an immutable floor", async () => {
  const mock = mocked(DEFAULT_DOD, audit);
  const result = await compileGoal({ goal, task, scenarios, call: mock.call });
  assert.equal(result.status, "approved");
  assert.deepEqual(mock.calls.map((c) => c.model), [PLANNER_MODEL, AUDITOR_MODEL]);
  assert.equal(result.planner.attempts, 1);
  assert.equal(result.feasibility.status, "not-ruled-out");
  assert.deepEqual(result.approved!.dod.checks[0], FLOOR_CHECKS[0]);
  assert.equal(result.approved!.hash, hashDoD(result.approved!.dod));
  assert.ok(Object.isFrozen(result.approved!.dod.checks));
});

test("malformed JSON gets exactly one repair and never executes as a check", async () => {
  const mock = mocked("not JSON", DEFAULT_DOD, audit);
  const result = await compileGoal({ goal, task, scenarios, call: mock.call });
  assert.equal(result.status, "approved");
  assert.equal(result.planner.attempts, 2);
  assert.deepEqual(mock.calls.map((c) => c.model), [PLANNER_MODEL, PLANNER_MODEL, AUDITOR_MODEL]);
  const exhausted = mocked({ goal, checks: [] }, { goal, checks: [] });
  const rejected = await compileGoal({ goal, task, scenarios, call: exhausted.call });
  assert.equal(rejected.status, "rejected");
  assert.equal(exhausted.calls.length, 2);
});

test("floor replacement, nonfinite values, unknown fields and duplicate IDs fail schema validation", () => {
  assert.match(definitionErrors({ ...DEFAULT_DOD, checks: [{ ...FLOOR_CHECKS[0], value: 1 }] }).join(" "), /non-negotiable/);
  assert.match(definitionErrors({ ...DEFAULT_DOD, checks: [{ ...DEFAULT_DOD.checks[0], value: Infinity }] }).join(" "), /finite/);
  assert.match(definitionErrors({ ...DEFAULT_DOD, checks: [DEFAULT_DOD.checks[0], DEFAULT_DOD.checks[0]] }).join(" "), /duplicate/);
  assert.match(definitionErrors({ ...DEFAULT_DOD, bypass: true }).join(" "), /unknown/);
});

test("vacuous and contradictory checks are rejected even if an auditor would approve", async () => {
  for (const checks of [
    [{ ...DEFAULT_DOD.checks[0], metric: "damaged", op: ">=", value: 0 }],
    [{ ...DEFAULT_DOD.checks[0], metric: "packages", op: "==", value: 100 }],
    [{ ...DEFAULT_DOD.checks[0], op: ">=", value: 2100 }, { ...DEFAULT_DOD.checks[0], id: "upper", value: 2000 }],
  ]) {
    const candidate = { goal, checks };
    const mock = mocked(candidate, candidate);
    const result = await compileGoal({ goal, task, scenarios, call: mock.call });
    assert.equal(result.status, "rejected");
    assert.equal(result.audit, null);
    assert.equal(mock.calls.length, 2);
  }
});

test("impossible one-second target escalates with code proof and no auditor call", async () => {
  const impossible = { goal: "Ship all 100 packages within 1 second.", checks: [{ ...DEFAULT_DOD.checks[0], value: 1 }] };
  const mock = mocked(impossible);
  const result = await compileGoal({ goal: impossible.goal, task, scenarios, call: mock.call });
  assert.equal(result.status, "escalate");
  assert.equal(result.audit, null);
  assert.equal(mock.calls.length, 1);
  assert.match(result.reasons[0], /contradicts the physical interval/);
  assert.match(result.reasons[0], /receiving dock/);
});

test("auditor veto and unavailable exact model both fail closed without fallback", async () => {
  for (const reply of [{ verdict: "veto", reasons: ["The model relaxed zero damage."] }, new Error("model not found")]) {
    const mock = mocked(DEFAULT_DOD, reply);
    const result = await compileGoal({ goal, task, scenarios, call: mock.call });
    assert.equal(result.status, "rejected");
    assert.equal(result.approved, null);
    assert.equal(mock.calls[1].model, "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B");
    assert.equal(mock.calls.length, 2);
  }
});

test("auditor sees the original goal and vetoes omitted quality checks and a relaxed deadline", async () => {
  const weakened = { goal, checks: [{ ...DEFAULT_DOD.checks[0], value: 1800 }] };
  const mock = mocked(weakened, { verdict: "veto", reasons: ["Deadline relaxed from 1500s to 1800s; mis-sort and zero-damage requirements omitted."] });
  const result = await compileGoal({ goal, task, scenarios, call: mock.call });
  assert.equal(result.status, "rejected");
  assert.equal(result.approved, null);
  assert.match(result.reasons[0], /omitted/);
  const messages = mock.calls[1].messages as { role: string; content: string }[];
  const supplied = JSON.parse(messages.find((m) => m.role === "user")!.content);
  assert.equal(supplied.goal, goal);
  assert.equal(supplied.proposed.checks.find((c: { id: string }) => c.id === "makespan").value, 1800);
  assert.ok(supplied.proposed.checks.some((c: { id: string }) => c.id === "all-shipped"));
  assert.match(messages[0].content, /omitted, relaxed, converted to an average/);
});

test("approval permits empty reasons; a veto still requires a nonempty explanation", async () => {
  for (const response of [{ verdict: "approve", reasons: [] }, { verdict: "approve" }]) {
    const mock = mocked(DEFAULT_DOD, response);
    assert.equal((await compileGoal({ goal, task, scenarios, call: mock.call })).status, "approved");
  }
  const mock = mocked(DEFAULT_DOD, { verdict: "veto", reasons: [] });
  const failed = await compileGoal({ goal, task, scenarios, call: mock.call });
  assert.equal(failed.status, "rejected");
  assert.match(failed.audit!.responsePreview!, /"verdict":"veto"/);
});

test("redundant shipped-count check cannot hide an impossible deadline", async () => {
  const impossible = { goal: "Ship all 100 packages within 1 second.", checks: [
    { id: "shipped", description: "Ship all 100", metric: "shipped", op: "==", value: 100, scope: "every" },
    { ...DEFAULT_DOD.checks[0], value: 1 },
  ] };
  const mock = mocked(impossible);
  const result = await compileGoal({ goal: impossible.goal, task, scenarios, call: mock.call });
  assert.equal(result.status, "escalate");
  assert.equal(mock.calls.length, 1);
  assert.match(result.reasons[0], /physical interval/);
  const empty = { ...impossible, checks: impossible.checks.slice(0, 1) };
  const noGoal = mocked(empty, empty);
  assert.equal((await compileGoal({ goal: empty.goal, task, scenarios, call: noGoal.call })).status, "rejected");
});

test("a previously approved goal cannot be weakened even if the auditor would approve it", async () => {
  const previous = sealDoD(DEFAULT_DOD);
  const weaker = { ...DEFAULT_DOD, checks: DEFAULT_DOD.checks.map((c) => c.id === "makespan" ? { ...c, value: 1800 } : c) };
  const mock = mocked(weaker, weaker);
  const result = await compileGoal({ goal, task, scenarios, call: mock.call, previous });
  assert.equal(result.status, "rejected");
  assert.match(result.reasons.join(" "), /weakens/);
  assert.ok(mock.calls.every((c) => c.model === PLANNER_MODEL));
});

test("one-line guard and transport failures do not spend a repair call", async () => {
  const bad = mocked();
  assert.equal((await compileGoal({ goal: "one\ntwo", task, scenarios, call: bad.call })).status, "rejected");
  assert.equal(bad.calls.length, 0);
  const down = mocked(new Error("connection failed"));
  assert.equal((await compileGoal({ goal, task, scenarios, call: down.call })).status, "rejected");
  assert.equal(down.calls.length, 1);
});

test("tighten-only lattice rejects relaxed, equivalent, scope-weakened and tampered contracts", () => {
  const previous = sealDoD(DEFAULT_DOD);
  const change = (value: number, scope = "every"): DefinitionOfDone => ({ ...DEFAULT_DOD, checks: DEFAULT_DOD.checks.map((c) => c.id === "makespan" ? { ...c, value, scope: scope as "every" | "mean" } : c) });
  assert.deepEqual(tighteningErrors(previous, change(1400)), []);
  assert.match(tighteningErrors(previous, change(1600)).join(" "), /weakens/);
  assert.match(tighteningErrors(previous, change(1500)).join(" "), /strictly tighter/);
  assert.match(tighteningErrors(previous, change(1400, "mean")).join(" "), /weakens/);
  assert.match(tighteningErrors(previous, { ...change(1400), checks: change(1400).checks.filter((c) => c.id !== "damaged") }).join(" "), /weakens/);
  const tampered = JSON.parse(JSON.stringify(previous));
  tampered.dod.checks[1].value = 1600;
  assert.throws(() => assertApprovedDoD(tampered), /integrity/);
  const floorTamper = JSON.parse(JSON.stringify(previous));
  floorTamper.dod.checks[0].description = "edited";
  assert.throws(() => assertApprovedDoD(floorTamper), /integrity/);
  assert.equal(hashDoD({ ...previous.dod, checks: [...previous.dod.checks].reverse() }), previous.hash);
});

test("sixteen goal checks survive the added floor through sealing, verification, and tightening", () => {
  const maximum: DefinitionOfDone = { goal, checks: Array.from({ length: 16 }, (_, i) => ({ ...DEFAULT_DOD.checks[0], id: `target-${i}` })) };
  assert.deepEqual(definitionErrors(maximum), []);
  assert.equal(DEFINITION_SCHEMA.properties.checks.maxItems, 16);
  const approved = sealDoD(maximum);
  assert.equal(approved.dod.checks.length, 17);
  assert.equal(assertApprovedDoD(approved).checks.length, 17);
  const tighter = { ...maximum, checks: maximum.checks.map((c, i) => i === 0 ? { ...c, value: 1400 } : c) };
  assert.deepEqual(tighteningErrors(approved, tighter), []);
  assert.deepEqual(tighteningErrors(approved, withFloors(tighter)), []);
  assert.equal(assertApprovedDoD(sealDoD(withFloors(tighter))).checks.length, 17);
  assert.ok(definitionErrors(withFloors(maximum)).length, "model input still has a strict 16-item cap");
  const oversized = { ...maximum, checks: [...maximum.checks, { ...maximum.checks[0], id: "overflow" }] };
  assert.ok(definitionErrors(oversized).length);
  assert.throws(() => sealDoD(oversized), /1\.\.16/);
  const badFloor = { ...approved.dod, checks: approved.dod.checks.map((c) => c.id === "all-shipped" ? { ...c, value: 1 } : c) };
  assert.throws(() => sealDoD(badFloor), /non-negotiable/);
});

test("mean constraints cannot imply every, while an every tightening can imply mean", () => {
  const mean = sealDoD({ ...DEFAULT_DOD, checks: DEFAULT_DOD.checks.map((c) => ({ ...c, scope: "mean" })) });
  assert.deepEqual(tighteningErrors(mean, DEFAULT_DOD), []);
});

test("physical bounds respect measured valid layouts, first arrival offset, and aggregate throughput", () => {
  const reference = JSON.parse(readFileSync(new URL("../test/fixtures/reference.json", import.meta.url), "utf8")) as Layout;
  const scenario = makeScenario(77, "peak", 100);
  const offset = { ...scenario, id: "offset", packages: scenario.packages.map((p) => ({ ...p, arrival: p.arrival + 700 })) };
  const bounds = physicalBounds(task, [scenario, offset]);
  for (const s of [scenario, offset]) {
    const result = simulate(reference, s);
    for (const b of bounds.filter((b) => b.scenarioId === s.id)) {
      assert.ok(result.metrics[b.metric] + 1e-8 >= b.lower, `${b.metric}=${result.metrics[b.metric]} < ${b.lower}`);
      if (b.upper !== null) assert.ok(result.metrics[b.metric] <= b.upper + 1e-8, `${b.metric}=${result.metrics[b.metric]} > ${b.upper}`);
    }
  }
  assert.equal(bounds.find((b) => b.scenarioId === scenario.id && b.metric === "makespan")!.lower, bounds.find((b) => b.scenarioId === "offset" && b.metric === "makespan")!.lower);
  const tooFast: DefinitionOfDone = { goal: "Impossible throughput", checks: [{ id: "throughput", description: "Impossible rate", metric: "throughputPerHour", op: ">=", value: 100_000, scope: "mean" }] };
  assert.equal(assessFeasibility(tooFast, bounds).status, "infeasible");
});
