import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { simulate } from '../../src/sim/engine.ts';
import { makeScenario, SPLITS } from '../../src/sim/scenarios.ts';
import { DEFAULT_DOD, evaluateDoD } from '../../src/sim/dod.ts';
import { graderHash } from '../../src/sim/version.ts';
import { validateForTask } from '../../src/tasks/task.ts';
import { buildingHash, contentHash, layoutHash } from '../../src/training/generate.ts';
import { legalMoveActions } from '../../src/training/optimizer-data.ts';
import { applyAction, parseAction, optimizerMessages } from '../../src/training/optimizer.ts';

const arms = ['base', 'tuned', 'random'];
const readJSON = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const readLines = (path: string) => readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const eq = (a: unknown, b: unknown, label: string) => assert.deepEqual(a, b, label);

// This audit deliberately derives measurements from the frozen simulator instead
// of calling the optimizer's measurement, acceptance or summary implementation.
function directMeasurement(task: any, layout: any, days: any[]) {
  eq(validateForTask(layout, task), [], 'Replayed layout must be legal');
  const results = days.map(day => simulate(layout, makeScenario(day.seed, day.profile, day.count)));
  const dod = evaluateDoD(DEFAULT_DOD, results);
  const keys = ['objective', 'makespan', 'damaged', 'missorts', 'unshipped', 'avgWait', 'travelCells'];
  const metrics: any = Object.fromEntries(keys.map(key => [key, mean(results.map(r => (r.metrics as any)[key]))]));
  const bottlenecks = layout.stations.filter((s: any) => ['sorter', 'pack'].includes(s.kind)).map((station: any) => {
    const stats = results.map(r => r.metrics.stations[station.id]);
    return { stationId: station.id, maxQueue: Math.max(...stats.map(s => s.maxQueue)), totalWait: mean(stats.map(s => s.totalWait)), utilization: mean(stats.map(s => s.utilization)) };
  }).sort((a: any, b: any) => b.totalWait - a.totalWait || a.stationId.localeCompare(b.stationId));
  return { valid: true, errors: [], objective: metrics.objective, goalMet: dod.passed, checks: dod.checks, metrics, bottlenecks, days: results.map(r => ({ seed: r.scenario.seed, profile: r.scenario.profile, metrics: r.metrics })) };
}

function independentAccept(before: any, after: any) {
  if (after.objective >= before.objective - 1e-9) return false;
  eq(before.days.map((d: any) => [d.seed, d.profile]), after.days.map((d: any) => [d.seed, d.profile]), 'Acceptance must use matched demand');
  const pass = (m: any, check: any) => check.op === '==' ? m[check.metric] === check.value : check.op === '<=' ? m[check.metric] <= check.value : m[check.metric] >= check.value;
  return before.days.every((day: any, i: number) => before.checks.every((check: any) => !pass(day.metrics, check) || pass(after.days[i].metrics, check)));
}

function checkedAction(task: any, layout: any, text: string) {
  const action = parseAction(text);
  const after = applyAction(task, layout, action);
  eq(validateForTask(after, task), [], 'Action result must pass immutable task rules');
  if (action.op === 'move') {
    assert.ok(!task.fixed.includes(action.stationId));
    const expected = structuredClone(layout);
    const station = expected.stations.find((s: any) => s.id === action.stationId);
    assert.ok(station && ['sorter', 'pack'].includes(station.kind));
    station.x = action.x; station.y = action.y;
    eq(after, expected, 'Only one station position may change');
  } else eq(after, layout, 'Stop cannot alter layout');
  return { action, after };
}

export function auditCompletedEvaluation(directory: string, options: { confirmedComplete: boolean; output?: string; allowFixtureCount?: boolean; recoveredCheckpoint?: string }) {
  assert.equal(options.confirmedComplete, true, 'Explicit confirmation that evaluation finished is required before test access');
  const started = Date.now(), evaluation = resolve(directory);
  const metricsPath = join(evaluation, 'metrics.json');
  assert.ok(existsSync(metricsPath), 'Evaluation is not finished: metrics.json absent');
  const reported = readJSON(metricsPath);
  assert.equal(reported.completed, true, 'This auditor requires a fully completed evaluation');
  assert.equal(reported.stopped, null, 'Evaluation must not have an interrupted search');
  const plan = readJSON(join(evaluation, 'evaluation-plan.json'));
  const receipts = readLines(join(evaluation, 'receipts.jsonl'));
  const searches = receipts.filter(r => r.type === 'search-complete');
  assert.equal(searches.length, 1); assert.equal(searches[0].stopped, null);
  assert.ok(!receipts.some(r => r.type === 'error'), 'Completed audit cannot silently omit request failures');
  assert.equal(contentHash(plan), reported.planHash);
  assert.equal(plan.finalEval, true); assert.equal(plan.live, true);
  assert.equal(plan.proposalsPerFactory, 3); assert.equal(plan.maxOutputTokens, 128);
  assert.equal(plan.temperature, 0); assert.equal(plan.automaticRetries, 0);
  if (!options.allowFixtureCount) assert.equal(plan.factoryLimit, 20);
  assert.ok(plan.factoryLimit <= 20 && plan.maxModelCalls <= 120);
  const proof = plan.provenance;
  assert.equal(proof.taskProfile, 'optimizer'); assert.equal(proof.promptProfile, 'nemotron8b-thinking-off-v1');
  assert.equal(proof.baseModel, plan.baseModel); assert.equal(proof.tunedModel, plan.tunedModel);
  assert.equal(proof.baseCheckpoint, proof.tunedBaseCheckpoint); assert.match(proof.baseCheckpoint, /@[a-f0-9]{40}$/);
  const health = readJSON(join(evaluation, 'health-receipt.json'));
  assert.equal(health.planHash, contentHash(plan)); assert.equal(health.health.status, 'ready');
  for (const key of ['trainingJobId', 'baseCheckpoint', 'taskProfile', 'promptProfile', 'dataset', 'adapterHashes']) eq(health.health[key], proof[key], `Health provenance ${key}`);
  let recoveredAdapterVerified = false;
  if (options.recoveredCheckpoint) {
    const training = readJSON(join(options.recoveredCheckpoint, 'manifest.json'));
    assert.equal(training.status, 'complete'); assert.equal(training.trainingJobId, proof.trainingJobId);
    assert.equal(`${training.baseModel}@${training.baseRevision}`, proof.baseCheckpoint);
    assert.equal(training.taskProfile, 'optimizer'); assert.equal(training.promptProfile, proof.promptProfile);
    assert.equal(training.smoke, false); assert.equal(training.epochs, 1); assert.equal(training.rank, 8); assert.equal(training.optimizerSteps, 150);
    eq(training.dataset, proof.dataset, 'Recovered training dataset'); eq(training.adapterHashes, proof.adapterHashes, 'Recovered adapter manifest');
    for (const name of ['adapter_config.json', 'adapter_model.safetensors']) {
      const hash = createHash('sha256').update(readFileSync(join(options.recoveredCheckpoint, 'adapter', name))).digest('hex');
      assert.equal(hash, proof.adapterHashes[name], `Recovered adapter bytes: ${name}`);
    }
    recoveredAdapterVerified = true;
  }
  const manifestText = readFileSync(join(plan.dataDirectory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(contentHash(manifestText), plan.manifestHash);
  assert.equal(plan.datasetFile, 'test-factories.jsonl');
  assert.equal(plan.datasetHash, manifest.files[plan.datasetFile].sha256);
  assert.equal(plan.datasetBytes, manifest.files[plan.datasetFile].bytes);
  assert.equal(graderHash(), plan.graderHash); assert.equal(manifest.graderHash, plan.graderHash);
  assert.equal(proof.dataset.graderHash, plan.graderHash);
  for (const [path, hash] of Object.entries(plan.sourceHashes)) assert.equal(contentHash(readFileSync(path, 'utf8')), hash, `Frozen source drift: ${path}`);
  for (const [path, hash] of Object.entries(manifest.sourceHashes)) assert.equal(contentHash(readFileSync(path, 'utf8')), hash, `Training source drift: ${path}`);
  for (const name of ['train.jsonl', 'validation.jsonl']) {
    const text = readFileSync(join(plan.dataDirectory, name), 'utf8');
    assert.equal(contentHash(text), manifest.files[name].sha256); assert.equal(Buffer.byteLength(text), manifest.files[name].bytes);
    assert.equal(proof.dataset.files[name], manifest.files[name].sha256);
  }

  // The sealed test is first opened only after explicit completion plus receipt gates.
  const testText = readFileSync(join(plan.dataDirectory, plan.datasetFile), 'utf8');
  assert.equal(contentHash(testText), plan.datasetHash); assert.equal(Buffer.byteLength(testText), plan.datasetBytes);
  const allCases = testText.trim().split('\n').map(line => JSON.parse(line)).sort((a, b) => a.id.localeCompare(b.id));
  const cases = allCases.slice(0, plan.factoryLimit);
  assert.equal(cases.length, plan.factoryLimit);
  const selection = readJSON(join(evaluation, 'selection.json'));
  assert.equal(selection.hash, contentHash(cases));
  eq(selection.cases, cases.map(c => ({ id: c.id, buildingHash: c.buildingHash, initialLayoutHash: c.initialLayoutHash })), 'Frozen selection');
  const buildings = new Set([...(manifest.excludedBuildingHashes ?? []), ...(manifest.splitBuildingHashes?.train ?? []), ...(manifest.splitBuildingHashes?.validation ?? [])]);
  const seeds = new Set([...Object.values(SPLITS).flat().map(d => d.seed), ...(manifest.splitDemandSeeds?.train ?? []), ...(manifest.splitDemandSeeds?.validation ?? [])]);
  const ids = new Set();
  for (const item of allCases) {
    assert.equal(item.split, 'test');
    assert.equal(item.buildingHash, buildingHash(item.task)); assert.equal(item.initialLayoutHash, layoutHash(item.initial));
    assert.ok(!ids.has(item.id)); ids.add(item.id); assert.ok(!buildings.has(item.buildingHash)); buildings.add(item.buildingHash);
    eq(validateForTask(item.initial, item.task), [], 'Held-out start legality');
    for (const days of [item.feedbackDays, item.finalDays]) {
      eq([...days.map((d: any) => d.profile)].sort(), ['fragile', 'normal', 'peak', 'skewed']);
      for (const day of days) { assert.equal(day.count, 100); assert.ok(Number.isSafeInteger(day.seed) && !seeds.has(day.seed)); seeds.add(day.seed); }
    }
  }
  const offered = cases.length * 3;
  const emptyBudget = () => ({ offeredProposals: offered, attemptedProposals: 0, modelCalls: 0, acceptedMoves: 0, invalidActions: 0, stops: 0, knownTokens: 0, reservedUnknownTokens: 0, simulations: 0, layoutEvaluations: 0 });
  const budgets: any = Object.fromEntries(arms.map(arm => [arm, emptyBudget()]));
  const states: any = new Map(cases.flatMap(item => arms.map(arm => [`${item.id}:${arm}`, { item, arm, layout: structuredClone(item.initial), feedback: null, previousAttempts: [], attemptedProposals: 0, acceptedMoves: 0, invalidActions: 0, status: 'pending', reason: null, pending: null, reply: null, candidate: null }])));
  let searchComplete = false, simulatedScenarios = 0;
  const responses = new Set();
  const modelOrder: { caseId: string; arm: string; round: number }[] = [];
  const remember = (state: any, attempt: any) => { state.previousAttempts = [...state.previousAttempts.slice(-2), attempt]; };
  for (const receipt of receipts) {
    if (receipt.type === 'search-complete') {
      assert.equal(searchComplete, false); searchComplete = true;
      for (const state of states.values()) {
        assert.equal(state.pending, null); assert.equal(state.reply, null); assert.equal(state.candidate, null);
        if (state.status === 'pending') { assert.equal(state.attemptedProposals, 3); state.status = 'complete'; }
      }
      eq(receipt.budgets, budgets, 'Search-complete budget ledger'); continue;
    }
    const state = states.get(`${receipt.caseId}:${receipt.arm}`);
    assert.ok(state, 'Receipt refers to selected case and known arm');
    const { item, arm } = state, budget = budgets[arm];
    if (receipt.type === 'pending') {
      assert.equal(searchComplete, false); assert.ok(arm !== 'random'); assert.equal(state.status, 'pending');
      assert.equal(state.pending, null); assert.equal(state.reply, null); assert.equal(receipt.round, state.attemptedProposals);
      assert.ok(receipt.round < 3); assert.equal(receipt.model, arm === 'base' ? plan.baseModel : plan.tunedModel);
      assert.equal(receipt.maxOutputTokens, 128);
      modelOrder.push({ caseId: item.id, arm, round: receipt.round });
      eq(receipt.messages, optimizerMessages(item.task, state.layout, state.feedback, state.previousAttempts), 'Prompt uses only reconstructed current state/history');
      assert.equal(receipt.promptHash, contentHash(receipt.messages));
      for (const day of item.finalDays) assert.ok(!JSON.stringify(receipt.messages).includes(String(day.seed)), 'Final day appears in prompt');
      const reservation = Buffer.byteLength(JSON.stringify(receipt.messages), 'utf8') + 4096 + 128;
      assert.equal(receipt.reservedTokens, reservation);
      assert.ok(budget.knownTokens + budget.reservedUnknownTokens + reservation <= plan.maxTokensPerArm);
      budget.modelCalls++; budget.attemptedProposals++; state.attemptedProposals++; budget.reservedUnknownTokens += reservation;
      state.pending = receipt;
    } else if (receipt.type === 'response') {
      assert.equal(searchComplete, false); assert.ok(state.pending); assert.equal(state.reply, null);
      assert.equal(receipt.round, state.pending.round);
      const reply = receipt.reply, usage = reply.usage;
      for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) assert.ok(Number.isSafeInteger(usage[key]) && usage[key] >= 0);
      assert.equal(usage.totalTokens, usage.promptTokens + usage.completionTokens); assert.ok(usage.completionTokens <= 128);
      assert.ok(usage.totalTokens <= state.pending.reservedTokens);
      budget.knownTokens += usage.totalTokens; budget.reservedUnknownTokens -= state.pending.reservedTokens;
      eq(receipt.budget, budget, 'Per-response token/call ledger');
      if (reply.responseId) { assert.ok(!responses.has(reply.responseId), 'Duplicate provider response ID'); responses.add(reply.responseId); }
      state.reply = reply; state.pending = null;
    } else if (receipt.type === 'simulation') {
      let expectedLayout: any, expectedDays: any;
      if (receipt.stage === 'initial-feedback') { assert.equal(searchComplete, false); assert.equal(state.feedback, null); expectedLayout = item.initial; expectedDays = item.feedbackDays; }
      else if (receipt.stage === 'candidate-feedback') {
        assert.equal(searchComplete, false); assert.equal(state.candidate, null);
        const action = arm === 'random' ? legalMoveActions(item.task, state.layout, plan.randomSeed + cases.indexOf(item) * 1009 + state.attemptedProposals, 1)[0] : checkedAction(item.task, state.layout, state.reply.content ?? '').action;
        assert.equal(action.op, 'move'); expectedLayout = checkedAction(item.task, state.layout, JSON.stringify(action)).after; expectedDays = item.feedbackDays;
        state.candidate = { action, layout: expectedLayout };
      } else {
        assert.equal(searchComplete, true, 'Final demand was scored before all search ended');
        assert.ok(['initial-final', 'champion-final'].includes(receipt.stage));
        expectedLayout = receipt.stage === 'initial-final' ? item.initial : state.layout; expectedDays = item.finalDays;
        assert.ok(!state[receipt.stage === 'initial-final' ? 'initialFinal' : 'championFinal']);
      }
      assert.equal(receipt.layoutHash, layoutHash(expectedLayout)); eq(receipt.days, expectedDays, 'Simulation demand identity');
      const result = directMeasurement(item.task, expectedLayout, expectedDays); simulatedScenarios += expectedDays.length;
      eq(receipt.result, result, 'Full independent simulator result');
      budget.layoutEvaluations++; budget.simulations += expectedDays.length;
      if (receipt.stage === 'initial-feedback') state.feedback = result;
      else if (receipt.stage === 'candidate-feedback') state.candidate.result = result;
      else state[receipt.stage === 'initial-final' ? 'initialFinal' : 'championFinal'] = result;
    } else if (receipt.type === 'action') {
      assert.equal(searchComplete, false); assert.equal(state.status, 'pending');
      if (arm === 'random') { assert.equal(receipt.round, state.attemptedProposals); budget.attemptedProposals++; state.attemptedProposals++; }
      else { assert.ok(state.reply); assert.equal(receipt.round, state.attemptedProposals - 1); }
      if (receipt.status === 'invalid-action') {
        assert.notEqual(arm, 'random'); let action: any, reason: string | undefined;
        try { action = parseAction(state.reply.content ?? ''); applyAction(item.task, state.layout, action); } catch (error) { reason = (error as Error).message.slice(0, 512); }
        assert.ok(reason, 'Invalid action was actually legal');
        const attempt = { ...(action ? { action } : { rawText: (state.reply.content ?? '').slice(0, 512) }), status: 'invalid', reason };
        eq(receipt.attempt, attempt, 'Invalid-action feedback'); remember(state, attempt);
        budget.invalidActions++; state.invalidActions++; assert.equal(receipt.retainedLayoutHash, layoutHash(state.layout));
      } else if (receipt.status === 'stopped') {
        assert.notEqual(arm, 'random'); eq(checkedAction(item.task, state.layout, state.reply.content ?? '').action, { op: 'stop' }, 'Stop action');
        eq(receipt.action, { op: 'stop' }, 'Stop receipt'); state.status = 'stopped'; state.reason = 'model_stop'; budget.stops++;
      } else {
        assert.ok(state.candidate?.result); eq(receipt.action, state.candidate.action, 'Receipt matches proposed action');
        const accepted = independentAccept(state.feedback, state.candidate.result);
        assert.equal(receipt.accepted, accepted, 'Independent acceptance rule');
        if (arm !== 'random') remember(state, { action: state.candidate.action, status: accepted ? 'accepted' : 'rejected', feedback: state.candidate.result, ...(accepted ? {} : { reason: 'Did not reduce the feedback objective while preserving every already-passed check' }) });
        if (accepted) { state.layout = state.candidate.layout; state.feedback = state.candidate.result; state.acceptedMoves++; budget.acceptedMoves++; }
        assert.equal(receipt.retainedLayoutHash, layoutHash(state.layout));
      }
      state.reply = null; state.candidate = null;
    } else assert.fail(`Unexpected receipt type: ${receipt.type}`);
  }
  assert.equal(searchComplete, true);
  const expectedOrder = [...modelOrder].sort((a, b) => {
    const ai = cases.findIndex(c => c.id === a.caseId), bi = cases.findIndex(c => c.id === b.caseId);
    if (ai !== bi) return ai - bi;
    if (a.round !== b.round) return a.round - b.round;
    const first = (ai + a.round) % 2 ? 'tuned' : 'base';
    return a.arm === b.arm ? 0 : a.arm === first ? -1 : 1;
  });
  eq(modelOrder, expectedOrder, 'Predetermined alternating model-arm order');
  assert.ok(budgets.base.modelCalls + budgets.tuned.modelCalls <= plan.maxModelCalls);
  const zero = (m: any) => m.days.every((day: any) => day.metrics.damaged === 0);
  const byArm: any = {};
  for (const arm of arms) {
    const rows: any[] = [...states.values()].filter(s => s.arm === arm), budget = budgets[arm];
    assert.ok(budget.simulations <= plan.maxSimulationsPerArm); assert.ok(budget.knownTokens <= plan.maxTokensPerArm); assert.equal(budget.reservedUnknownTokens, 0);
    assert.ok(budget.modelCalls <= offered); assert.ok(budget.attemptedProposals <= offered);
    for (const row of rows) {
      assert.ok(row.initialFinal && row.championFinal);
      const got = reported.cases.find((s: any) => s.caseId === row.item.id && s.arm === arm); assert.ok(got);
      for (const key of ['layout', 'feedback', 'previousAttempts', 'attemptedProposals', 'acceptedMoves', 'invalidActions', 'status', 'reason', 'initialFinal', 'championFinal']) eq(got[key], row[key], `Final reconstructed state ${key}`);
    }
    const deltas = rows.map(s => s.championFinal.objective - s.initialFinal.objective);
    byArm[arm] = { factories: cases.length, completedSearches: cases.length, scoredFactories: cases.length, missingScores: 0, initialGoalPasses: rows.filter(s => s.initialFinal.goalMet).length, finalGoalPasses: rows.filter(s => s.championFinal.goalMet).length, initialZeroDamage: rows.filter(s => zero(s.initialFinal)).length, finalZeroDamage: rows.filter(s => zero(s.championFinal)).length, meanInitialObjective: mean(rows.map(s => s.initialFinal.objective)), meanFinalObjective: mean(rows.map(s => s.championFinal.objective)), meanObjectiveDelta: mean(deltas), objectiveImprovements: deltas.filter(d => d < 0).length, budget: { ...budget, skippedProposals: offered - budget.attemptedProposals } };
    eq(reported.overall[arm], byArm[arm], `Independent ${arm} aggregate`);
  }
  eq(reported.cases.length, cases.length * 3, 'No missing or duplicate final state');
  assert.equal(reported.pairedCases, cases.length); assert.equal(reported.incompletePairs, 0);
  const pairs = cases.map(item => {
    const base = states.get(`${item.id}:base`), tuned = states.get(`${item.id}:tuned`);
    return { caseId: item.id, buildingHash: item.buildingHash, complete: true, baseGoalMet: base.championFinal.goalMet, tunedGoalMet: tuned.championFinal.goalMet, baseZeroDamage: zero(base.championFinal), tunedZeroDamage: zero(tuned.championFinal), tunedMinusBaseObjective: tuned.championFinal.objective - base.championFinal.objective };
  });
  eq(reported.pairs, pairs, 'Per-factory paired results');
  const pairedWins = { base: pairs.filter(p => p.tunedMinusBaseObjective > 0).length, tuned: pairs.filter(p => p.tunedMinusBaseObjective < 0).length, ties: pairs.filter(p => p.tunedMinusBaseObjective === 0).length };
  const goalWins = { base: pairs.filter(p => p.baseGoalMet && !p.tunedGoalMet).length, tuned: pairs.filter(p => p.tunedGoalMet && !p.baseGoalMet).length, ties: pairs.filter(p => p.baseGoalMet === p.tunedGoalMet).length };
  const damageWins = { base: pairs.filter(p => p.baseZeroDamage && !p.tunedZeroDamage).length, tuned: pairs.filter(p => p.tunedZeroDamage && !p.baseZeroDamage).length, ties: pairs.filter(p => p.baseZeroDamage === p.tunedZeroDamage).length };
  eq(reported.pairedWins, pairedWins, 'Objective wins'); eq(reported.pairedGoalWins, goalWins, 'Goal wins'); eq(reported.pairedZeroDamageWins, damageWins, 'Zero-damage wins');
  const pairwise: any = {};
  for (const [left, right] of [['base', 'tuned'], ['base', 'random'], ['tuned', 'random']]) {
    const diffs = cases.map(item => states.get(`${item.id}:${right}`).championFinal.objective - states.get(`${item.id}:${left}`).championFinal.objective);
    pairwise[`${left}-vs-${right}`] = { [left]: diffs.filter(d => d > 0).length, [right]: diffs.filter(d => d < 0).length, ties: diffs.filter(d => d === 0).length };
  }
  assert.equal(graderHash(), plan.graderHash);
  for (const [path, hash] of Object.entries(plan.sourceHashes)) assert.equal(contentHash(readFileSync(path, 'utf8')), hash);
  const audit = { schemaVersion: 1, auditedAt: new Date().toISOString(), status: 'passed', evaluation, planHash: contentHash(plan), manifestHash: plan.manifestHash, graderHash: plan.graderHash, receiptHash: contentHash(readFileSync(join(evaluation, 'receipts.jsonl'), 'utf8')), metricsHash: contentHash(readFileSync(metricsPath, 'utf8')), factories: cases.length, arms: 3, simulatedScenarios, receiptCount: receipts.length, recoveredAdapterVerified, checks: ['pinned checkpoint and adapter/dataset provenance', 'whole-building and demand independence', 'all prompts reconstructed from current state and past feedback only', 'action legality and exact one-station mutations', 'all feedback and final metrics independently replayed', 'acceptance preserves passed day checks and strictly improves objective', 'random baseline actions reproduced', 'no final simulations before search-complete', 'call/token/simulator caps and all ledger snapshots', 'no retries, missing usage or unsettled reservations', 'all final states and aggregate/pairwise reports'], overall: byArm, pairwise, elapsedMs: Date.now() - started, limitations: ['Audit verifies saved evidence and current frozen sources; it does not attest remote hardware.', ...(!recoveredAdapterVerified ? ['Recovered adapter bytes were not supplied; only matching provenance receipts were checked.'] : []), 'Results concern synthetic factories in this generator family.'] };
  const output = resolve(options.output ?? join('runs/optimizer-audit', `${basename(evaluation)}-audit.json`));
  assert.ok(output.startsWith(resolve('runs/optimizer-audit') + '/')); assert.ok(!existsSync(output), 'Refuse overwriting audit');
  mkdirSync(resolve('runs/optimizer-audit'), { recursive: true }); writeFileSync(output, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
  return { audit, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, directory, output, recoveredCheckpoint] = process.argv.slice(2);
  assert.equal(flag, '--confirmed-complete', 'Usage: npx tsx runs/optimizer-audit/audit.ts --confirmed-complete EVALUATION_DIRECTORY [OUTPUT_JSON] [RECOVERED_CHECKPOINT_DIR]');
  assert.ok(directory);
  const { audit, output: written } = auditCompletedEvaluation(directory, { confirmedComplete: true, output, recoveredCheckpoint });
  console.log(JSON.stringify({ status: audit.status, factories: audit.factories, simulations: audit.simulatedScenarios, pairwise: audit.pairwise, output: written }));
}
