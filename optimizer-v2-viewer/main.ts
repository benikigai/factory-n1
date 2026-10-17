import '../optimizer-viewer/style.css';
import './style.css';
import { createWarehouse, type Selection } from '../web/world/warehouse';
import { playbackEnd } from '../web/world/state';
import { h, fmtNum, fmtTime } from '../web/ui/dom';
import type { ReplayBundle } from '../src/replay';
import type { V2Model } from '../src/training/optimizer-v2-evaluate';
import { MODELS, BASELINES, LABELS, modelLabel, type Factory, type Snapshot, type V2Catalog, type V2Replay } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
el('app').innerHTML = `<header class="masthead"><div><div class="eyebrow">Factory N+1 / Separate optimizer v2 evaluation</div><h1 id="page-title">Better data, more epochs, or more attempts?</h1></div><span id="mode" class="pill">WAITING FOR VERIFIED REPLAYS</span></header><section id="cohort-banner" class="cohort-banner" aria-label="Evaluation scope" hidden></section>
<div class="workspace"><main class="main"><section class="comparison-top"><div class="comparison-title"><h2 id="case-title">Load a completed evaluation to compare</h2><span id="gain" class="gain"></span></div>
<div class="pair-controls"><label>Left model<select id="left"></select></label><label>Right model<select id="right"></select></label><label>Retained layout<select id="snapshot"><option value="round3">After 3 proposals</option><option value="round12" selected>After 12 proposals</option></select></label></div>
<div class="score-grid"><article class="score"><div><div id="left-label" class="label"></div><strong id="left-score">…</strong><small>Mean objective · four final days · lower is better</small></div><div id="left-sub" class="sub"></div></article><article class="score tuned"><div><div id="right-label" class="label"></div><strong id="right-score">…</strong><small>Mean objective · four final days · lower is better</small></div><div id="right-sub" class="sub"></div></article></div></section>
<div class="scene-wrap"><div id="scene" class="hide-stations"></div><div class="scene-note" id="scene-note">MATCHED SCENARIO · SHARED CLOCK</div><div class="legend"><span style="--dot:#3b82f6">Zone A</span><span style="--dot:#a855f7">Zone B</span><span style="--dot:#14b8a6">Zone C</span><span style="--dot:#ef4444">Damaged</span><span>Drag to orbit · scroll to zoom</span></div><div id="error" class="error">Loading completed evaluation…</div></div>
<div class="playback"><button id="play">Pause</button><button id="restart">Restart</button><select id="speed" aria-label="Replay speed"><option value="16">16×</option><option value="60" selected>60×</option><option value="120">120×</option></select><span id="clock" class="time"></span><input id="time" aria-label="Shared replay time" type="range" min="0" max="1" step="0.5" value="0"><button id="end">End</button><button id="fit">Fit view</button></div>
<div class="statusbar">Saved model outputs and re-scored simulator traces. No live inference. The original hackathon demo is separate.</div>
<section id="aggregate-section" class="model-overview"><h2 id="aggregate-title">All models, all included test factories</h2><p class="micro">Same base checkpoint. Matched proposal opportunities. The original-data control compares extra training with the new curriculum.</p><table><thead><tr><th>Model</th><th>Objective, 3</th><th>Objective, 12</th><th>Zero damage, 3 / 12</th><th>Full goal, 3 / 12</th></tr></thead><tbody id="models"></tbody></table></section></main>
<aside class="sidebar"><section><h2>Choose the comparison</h2><label class="field">Fresh factory<select id="factory"></select></label><p id="selection" class="micro"></p><label class="field">Final demand day<select id="day"></select></label><p id="day-meta" class="micro"></p><label class="check"><input id="labels" type="checkbox">Show station labels</label></section>
<section><h2>Displayed day</h2><table><thead><tr><th>Outcome</th><th>Left</th><th>Right</th></tr></thead><tbody id="day-scores"></tbody></table><p class="micro">Complete-day scores. Animation counters reflect the current shared replay time.</p></section>
<section><h2>This factory, 3 vs 12</h2><table><thead><tr><th>Model</th><th>Objective, 3</th><th>Objective, 12</th></tr></thead><tbody id="factory-models"></tbody></table><p id="proposals" class="note"></p></section>
<section><h2>Procedural references</h2><p class="micro">These are algorithms, not fine-tuned models. The geometric planner has privileged rules and extra search computation.</p><table><thead><tr><th>Reference</th><th>Objective, 3</th><th>Objective, 12</th></tr></thead><tbody id="baselines"></tbody></table><p id="planning" class="micro"></p></section>
<section><h2>Selected station</h2><div id="station" class="station">Select a station to inspect its positions and wait times.</div></section>
<section><h2>Evidence and limits</h2><div class="evidence-links"><a id="replay-link" target="_blank" rel="noopener">Current traces</a><a href="./catalog.json" target="_blank" rel="noopener">All measured scores</a><a href="./replay-export-receipt.json" target="_blank" rel="noopener">Replay verification receipt</a></div><p id="scope" class="micro"></p><p id="hash" class="micro"></p><p class="note">This is a small synthetic-factory benchmark. Lower objective does not by itself mean zero damage or full-goal completion.</p></section></aside></div>`;

let catalog: V2Catalog, selected: Factory, replay: V2Replay | null = null, bundle: ReplayBundle | null = null;
let revision = 0, time = 0, end = 1, speed = 60, last = performance.now();
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const model = (id: 'left' | 'right') => el<HTMLSelectElement>(id).value as V2Model;
const snapshot = () => el<HTMLSelectElement>('snapshot').value as Snapshot;
const num = (value: number) => fmtNum(value, 2);
const label = (model: V2Model) => modelLabel(model, catalog?.models ?? {});
const tableRow = (...values: (string | number)[]) => h('tr', null, ...values.map(value => h('td', null, value)));
const world = createWarehouse(el('scene'), inspect);
for (const id of ['left', 'right'] as const) el(id).replaceChildren(...MODELS.map(value => h('option', { value }, LABELS[value])));
el<HTMLSelectElement>('left').value = MODELS.includes(params.get('left') as V2Model) ? params.get('left')! : MODELS[0];
el<HTMLSelectElement>('right').value = MODELS.includes(params.get('right') as V2Model) ? params.get('right')! : MODELS[3];
el<HTMLSelectElement>('snapshot').value = params.get('snapshot') === 'round3' ? 'round3' : 'round12';

async function json<T>(file: string): Promise<T> {
  const response = await fetch(new URL(file, location.href));
  if (!response.ok) throw new Error(`No completed replay data available: ${file} (${response.status})`);
  return response.json() as Promise<T>;
}
function clock() {
  el('clock').textContent = `${fmtTime(time)} / ${fmtTime(end)}`;
  el<HTMLInputElement>('time').value = String(time);
  el('play').textContent = playing ? 'Pause' : time >= end ? 'Replay' : 'Play';
}
function inspect(selection: Selection) {
  if (selection.type !== 'station' || !bundle) return;
  const a = bundle.baseline.layout.stations.find(station => station.id === selection.id)!, b = bundle.improved.layout.stations.find(station => station.id === selection.id)!;
  const am = bundle.baseline.result.metrics.stations[selection.id], bm = bundle.improved.result.metrics.stations[selection.id];
  el('station').replaceChildren(h('strong', null, selection.id), h('div', null, `Left (${a.x}, ${a.y}) → right (${b.x}, ${b.y})`), h('div', null, `Total wait: ${num(am.totalWait)} s → ${num(bm.totalWait)} s`), h('div', null, `Maximum queue: ${am.maxQueue} → ${bm.maxQueue}`));
}
function renderPair() {
  if (!replay) return;
  const left = model('left'), right = model('right'), step = snapshot();
  const a = replay.arms[left][step], b = replay.arms[right][step];
  bundle = { runId: `${selected.id}-${replay.scenario.profile}-${step}`, mode: catalog.mode, createdAt: catalog.createdAt, graderHash: catalog.graderHash, simVersion: catalog.simVersion, scenario: replay.scenario, task: { id: selected.id, goal: 'Ship all 100 packages within 25 minutes with at most one mis-sort and nothing damaged.' }, baseline: a, improved: b, accepted: [], rejected: [], lessons: [], comparators: [], curve: [], usage: { calls: 0, usd: 0, searches: 0, searchUsd: 0 } };
  world.setBundle(bundle); world.preset('overview', false);
  time = 0; end = playbackEnd(a.result.trace, b.result.trace); el<HTMLInputElement>('time').max = String(end);
  for (const [id, arm] of [['left', left], ['right', right]] as const) {
    const value = selected.arms[arm].snapshots[step];
    el(`${id}-label`).textContent = label(arm); el(`${id}-score`).textContent = num(value.metrics.objective);
    el(`${id}-sub`).textContent = `${num(value.metrics.damaged)} mean damaged\nZero damage: ${value.zeroDamage ? 'yes' : 'no'}\nFull goal: ${value.goalMet ? 'met' : 'not met'}`;
  }
  const base = selected.arms[left].snapshots[step].metrics.objective, candidate = selected.arms[right].snapshots[step].metrics.objective;
  const gain = base ? (base - candidate) / base * 100 : 0;
  el('gain').textContent = gain > 0 ? `Right: ${num(gain)}% lower objective` : gain < 0 ? `Right: ${num(-gain)}% higher objective` : 'Equal objective';
  el('gain').classList.toggle('negative', gain < 0);
  el('gain').hidden = catalog.cohort.kind === 'interrupted';
  el('scene-note').textContent = `${step === 'round3' ? '3' : '12'} PROPOSAL SNAPSHOT · ${replay.scenario.profile.toUpperCase()} · SHARED CLOCK`;
  el('day-scores').replaceChildren(tableRow('Objective ↓', num(a.result.metrics.objective), num(b.result.metrics.objective)), tableRow('Damaged ↓', a.result.metrics.damaged, b.result.metrics.damaged), tableRow('Shipped', a.result.metrics.shipped, b.result.metrics.shipped), tableRow('Makespan ↓', `${num(a.result.metrics.makespan)} s`, `${num(b.result.metrics.makespan)} s`));
  el('proposals').textContent = `Entire 12-opportunity search: left ${selected.arms[left].attempted} attempted, ${selected.arms[left].accepted} accepted, ${selected.arms[left].invalid} invalid; right ${selected.arms[right].attempted} attempted, ${selected.arms[right].accepted} accepted, ${selected.arms[right].invalid} invalid. Early stop can use fewer attempts.`;
  el('station').textContent = 'Select a station to inspect its positions and wait times.';
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ factory: selected.id, day: replay.scenario.profile, left, right, snapshot: step })) url.searchParams.set(key, value);
  history.replaceState(null, '', url); clock();
}
async function loadDay(profile: string) {
  const current = ++revision, choice = selected.replays.find(value => value.profile === profile) ?? selected.replays[0];
  replay = null; bundle = null; el('error').hidden = false; el('error').textContent = 'Loading matched traces…';
  try {
    const loaded = await json<V2Replay>(choice.file);
    if (current !== revision) return;
    if (loaded.caseId !== selected.id || loaded.scenario.seed !== choice.seed) throw new Error('Replay identity differs from selected factory/day');
    replay = loaded; el('error').hidden = true; el<HTMLSelectElement>('day').value = choice.profile;
    el('day-meta').textContent = `${choice.profile} demand · seed ${choice.seed} · the same 100 packages for all models.`;
    el<HTMLAnchorElement>('replay-link').href = `./${choice.file}`;
    renderPair();
  } catch (error) { if (current === revision) el('error').textContent = error instanceof Error ? error.message : 'Replay load failed'; }
}
async function chooseFactory(id: string) {
  selected = catalog.cases.find(value => value.id === id) ?? catalog.cases.find(value => value.id === catalog.defaultCaseId)!;
  el<HTMLSelectElement>('factory').value = selected.id; el('case-title').textContent = selected.id;
  el('day').replaceChildren(...selected.replays.map(value => h('option', { value: value.profile }, value.profile)));
  el('selection').textContent = catalog.cohort.kind === 'interrupted' ? 'Only the two independently audited, fully paired factories are available. Selection follows completion status, not performance. These are exploratory cases.' : selected.id === catalog.defaultCaseId ? `Default: the upper-middle case across all ${catalog.cases.length} included v2 versus base gains at 12 proposals. Every included loss and tie is retained.` : 'User-selected factory. The default is the upper-middle included v2 versus base result at 12 proposals.';
  el('factory-models').replaceChildren(...MODELS.map(arm => tableRow(label(arm), num(selected.arms[arm].snapshots.round3.metrics.objective), num(selected.arms[arm].snapshots.round12.metrics.objective))));
  el('baselines').replaceChildren(...BASELINES.map(arm => tableRow(LABELS[arm], num(selected.arms[arm].snapshots.round3.metrics.objective), num(selected.arms[arm].snapshots.round12.metrics.objective))));
  const teacher = selected.arms['geometric-teacher'];
  el('planning').textContent = `Geometric planning overhead: ${teacher.planningSimulations} additional feedback simulations; ${num(teacher.planningMs)} ms. These are outside model proposal budgets.`;
  await loadDay(new URLSearchParams(location.search).get('day') ?? 'normal');
}
el('factory').onchange = () => void chooseFactory(el<HTMLSelectElement>('factory').value);
el('day').onchange = () => void loadDay(el<HTMLSelectElement>('day').value);
for (const id of ['left', 'right', 'snapshot']) el(id).onchange = renderPair;
el('play').onclick = () => { if (time >= end) time = 0; playing = !playing; clock(); };
el('restart').onclick = () => { time = 0; playing = true; clock(); };
el('end').onclick = () => { time = end; playing = false; clock(); };
el('fit').onclick = () => world.preset('overview');
el('speed').onchange = () => { speed = Number(el<HTMLSelectElement>('speed').value); };
el('time').oninput = () => { time = Number(el<HTMLInputElement>('time').value); playing = false; clock(); };
el('labels').onchange = () => el('scene').classList.toggle('hide-stations', !el<HTMLInputElement>('labels').checked);
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
  if (bundle) {
    if (playing) { time = Math.min(end, time + dt * speed); if (time >= end) playing = false; }
    const values = world.render(time, now / 1000);
    if (values) world.setCounters(...values.map(value => `shipped ${value.shipped}/100 · queued ${value.queued} · damaged ${value.damaged}`) as [string, string]);
    clock();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void (async () => {
  try {
    catalog = await json<V2Catalog>('catalog.json');
    const interrupted = catalog.cohort.kind === 'interrupted';
    for (const id of ['left', 'right'] as const) { const current = model(id); el(id).replaceChildren(...MODELS.map(value => h('option', { value }, label(value)))); el<HTMLSelectElement>(id).value = current; }
    el('mode').textContent = catalog.mode === 'synthetic' ? 'SYNTHETIC TEST FIXTURE · NOT RESULTS' : interrupted ? 'INTERRUPTED · 2/20 FULLY PAIRED' : catalog.cohort.kind === 'continuation' ? `CONTINUATION · ${catalog.cases.length}/${catalog.cohort.originalFactories} FACTORIES` : 'RECORDED · RE-SCORED TRACES';
    if (interrupted) {
      el('page-title').textContent = 'Interrupted optimizer pilot';
      el('cohort-banner').hidden = false;
      el('cohort-banner').replaceChildren(h('strong', null, catalog.cohort.disclosure), h('p', null, 'Only factories 1 and 10 finished with matched model outcomes. They are an availability-selected subset. The other factories are not treated as completed outcomes; no benchmark winner is established.'));
    } else if (catalog.cohort.kind === 'continuation') {
      const cohort = catalog.cohort;
      el('cohort-banner').hidden = false;
      el('cohort-banner').replaceChildren(h('strong', null, `${cohort.includedFactories} of the original ${cohort.originalFactories} factories completed. ${cohort.excludedFactories.length} interrupted factory excluded from every comparison.`), h('p', null, cohort.disclosure), h('p', null, `Excluded: ${cohort.excludedFactories.map(item => item.id).join(', ')}. Original run: ${cohort.originalResolvedRequests ?? '?'} resolved requests and ${cohort.originalUnknownRequests ?? '?'} unresolved. All scores and rates below use only the ${cohort.includedFactories} included factories.`));
    }
    el('aggregate-title').textContent = `All models, ${catalog.cases.length} included test factories`;
    el('factory').replaceChildren(...catalog.cases.map(value => h('option', { value: value.id }, interrupted ? value.id : `${value.id} · ${value.v2VsBasePercent > 0 ? '+' : ''}${num(value.v2VsBasePercent)}%`)));
    el('aggregate-section').hidden = interrupted;
    if (!interrupted && catalog.aggregate) {
      const aggregate = catalog.aggregate;
      el('models').replaceChildren(...MODELS.map(arm => { const a = aggregate[arm].round3, b = aggregate[arm].round12; return tableRow(label(arm), num(a.meanObjective), num(b.meanObjective), `${a.zeroDamage} / ${b.zeroDamage} of ${catalog.cases.length}`, `${a.goalPasses} / ${b.goalPasses} of ${catalog.cases.length}`); }));
    }
    el('scope').textContent = `${catalog.scope} ${catalog.cohort.disclosure}`;
    el('hash').textContent = `Grader ${catalog.graderHash.slice(0, 12)} · ${catalog.cases.length} included factories of ${catalog.cohort.originalFactories} original · four final days each.`;
    await chooseFactory(params.get('factory') ?? catalog.defaultCaseId);
  } catch (error) { el('error').textContent = error instanceof Error ? error.message : 'Evaluation not available'; }
})();
