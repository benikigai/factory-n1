import './style.css';
import { createWarehouse, type Selection } from '../web/world/warehouse';
import { playbackEnd } from '../web/world/state';
import { h, fmtNum, fmtTime } from '../web/ui/dom';
import type { Catalog, CatalogCase, CatalogArm, OptimizerReplay } from '../src/training/optimizer-replay';

const root = document.querySelector<HTMLDivElement>('#optimizer-app')!;
root.innerHTML = `<header class="masthead"><div><div class="eyebrow">Factory N+1 / Optimizer experiment</div><h1>Base model. Fine-tuned model. Same factory.</h1></div><span class="pill">RECORDED · INDEPENDENTLY SCORED</span></header>
<div class="workspace"><main class="main"><section class="comparison-top"><div class="comparison-title"><h2 id="case-title">Loading verified comparison…</h2><span id="gain" class="gain"></span></div><div class="score-grid"><article class="score"><div><div class="label">Base Nemotron 8B</div><strong id="base-score">…</strong><small>Mean objective · four held-out days · lower is better</small></div><div id="base-sub" class="sub"></div></article><article class="score tuned"><div><div class="label">Fine-tuned Nemotron 8B</div><strong id="tuned-score">…</strong><small>Mean objective · four held-out days · lower is better</small></div><div id="tuned-sub" class="sub"></div></article></div></section>
<div class="scene-wrap"><div id="scene" class="hide-stations"></div><div class="scene-note" id="scene-note">TRACE-EXACT REPLAY · ONE SHARED CLOCK</div><div class="legend"><span style="--dot:#3b82f6">Zone A</span><span style="--dot:#a855f7">Zone B</span><span style="--dot:#14b8a6">Zone C</span><span style="--dot:#ef4444">Damaged</span><span>Drag to orbit · scroll to zoom</span></div><div id="error" class="error" hidden></div></div>
<div class="playback"><button id="play">Pause</button><button id="restart" aria-label="Restart synchronized replay">Restart</button><select id="speed" aria-label="Replay speed"><option value="16">16×</option><option value="60" selected>60×</option><option value="120">120×</option></select><span class="time" id="clock">00:00 / 00:00</span><input id="time" type="range" aria-label="Synchronized replay time" min="0" max="1" step="0.5" value="0"><button id="end">End</button><button id="overview">Fit view</button></div>
<div class="statusbar">Saved model proposals and simulator traces. No live model calls. Separate local review; the frozen demo is unchanged.</div></main>
<aside class="sidebar"><section><h2>Explore the held-out test</h2><label class="field">Fresh factory<select id="factory" aria-label="Fresh factory"></select></label><p class="micro" id="selection-rule"></p><label class="field">Replay demand day<select id="day" aria-label="Replay demand day"></select></label><p class="micro" id="day-meta"></p><label class="check"><input id="labels" type="checkbox"> Show station labels</label></section>
<section><h2>This replay day</h2><table aria-label="Selected demand day measured scores"><thead><tr><th>Measured outcome</th><th>Base</th><th>Tuned</th></tr></thead><tbody id="day-scores"></tbody></table><p class="micro" style="margin-top:9px">These are complete-run scores for the displayed day. In-scene counters show progress at the shared replay time.</p></section>
<section><h2>Layout changes from the starting factory</h2><div id="changes" class="changes"></div><div id="proposals" class="note"></div></section>
<section><h2>All 20 factories</h2><table aria-label="Overall experiment"><thead><tr><th>Four-day means</th><th>Base</th><th>Tuned</th></tr></thead><tbody id="overall"></tbody></table><p class="micro" id="overall-note" style="margin-top:9px"></p><p class="note warning">Neither model reached zero damage or the full goal on any test factory. Fine-tuning improved this benchmark, but invalid moves and regressions remain.</p></section>
<section><h2>Selected station</h2><div id="station" class="station">Select a machine in either 3D floor to compare its position and measured wait.</div></section>
<section><h2>Evidence</h2><div class="evidence-links"><a id="replay-link" target="_blank" rel="noopener">This replay JSON</a><a href="./catalog.json" target="_blank" rel="noopener">All factory scores</a><a href="./optimizer-pilot-audit.json" target="_blank" rel="noopener">Independent audit</a><a href="./nemotron-optimizer-pilot.md" target="_blank" rel="noopener">Methods and limits</a></div><p class="micro" id="hash" style="margin-top:10px"></p></section></aside></div>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
let catalog: Catalog;
let selected: CatalogCase;
let replay: OptimizerReplay | null = null;
let loadRevision = 0;
let simTime = 0;
let endTime = 1;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let speed = 60;
let lastFrame = performance.now();
const world = createWarehouse(el('scene'), inspect);
const signedPercent = (value: number) => `${value > 0 ? '+' : ''}${fmtNum(value, 2)}%`;
const number = (value: number) => fmtNum(value, 2);

async function getJson<T>(file: string): Promise<T> {
  const response = await fetch(new URL(file, location.href));
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
  return response.json() as Promise<T>;
}
function row(name: string, base: string | number, tuned: string | number) {
  return h('tr', null, h('td', null, name), h('td', null, base), h('td', null, tuned));
}
function updateClock() {
  el('clock').textContent = `${fmtTime(simTime)} / ${fmtTime(endTime)}`;
  el<HTMLInputElement>('time').value = String(simTime);
  el('play').textContent = playing ? 'Pause' : simTime >= endTime ? 'Replay' : 'Play';
}
function armSummary(arm: CatalogArm) {
  return `${number(arm.finalMetrics.makespan)} s mean makespan\n${number(arm.finalMetrics.damaged)} mean damaged\nFull goal: ${arm.goalMet ? 'met' : 'not met'}`;
}
function renderChanges() {
  const groups = [['Base', selected.base], ['Fine-tuned', selected.tuned]] as const;
  el('changes').replaceChildren(...groups.map(([title, arm]) => {
    const moves = arm.layout.stations.flatMap(station => {
      const before = selected.initialLayout.stations.find(s => s.id === station.id)!;
      return before.x !== station.x || before.y !== station.y ? [h('div', { class: 'change' }, h('span', null, station.id), h('code', null, `(${before.x},${before.y}) → (${station.x},${station.y})`))] : [];
    });
    return h('div', null, h('p', { class: 'micro', style: 'margin-bottom:5px' }, title), ...(moves.length ? moves : [h('p', { class: 'micro' }, 'Retained the starting layout.')])) ;
  }));
  el('proposals').textContent = `Same three proposal opportunities. Base: ${selected.base.acceptedMoves} accepted, ${selected.base.invalidActions} invalid. Fine-tuned: ${selected.tuned.acceptedMoves} accepted, ${selected.tuned.invalidActions} invalid. Rejected proposals leave the retained layout unchanged.`;
}
function renderAggregate() {
  const gain = selected.comparison.tunedVsBasePercent;
  el('case-title').textContent = selected.id.replace('optimizer-test-building-', 'Fresh factory ');
  el('base-score').textContent = number(selected.base.finalMetrics.objective);
  el('tuned-score').textContent = number(selected.tuned.finalMetrics.objective);
  el('base-sub').textContent = armSummary(selected.base);
  el('tuned-sub').textContent = armSummary(selected.tuned);
  el('base-sub').style.whiteSpace = el('tuned-sub').style.whiteSpace = 'pre-line';
  el('gain').textContent = gain > 0 ? `${number(gain)}% lower objective` : gain < 0 ? `${number(-gain)}% higher objective` : 'Equal objective';
  el('gain').classList.toggle('negative', gain < 0);
  el('selection-rule').textContent = selected.id === catalog.defaultCaseId ? 'Default: the middle factory after ranking all 20 by paired improvement. Larger wins, losses and ties are also available.' : 'You selected this factory. The default is the middle case across all 20, rather than the largest gain.';
  renderChanges();
}
function inspect(selection: Selection) {
  if (selection.type !== 'station' || !replay) return;
  const id = selection.id;
  const a = replay.baseline.layout.stations.find(s => s.id === id)!;
  const b = replay.improved.layout.stations.find(s => s.id === id)!;
  const sa = replay.baseline.result.metrics.stations[id];
  const sb = replay.improved.result.metrics.stations[id];
  el('station').replaceChildren(h('strong', null, id), h('div', null, `${a.kind} · base (${a.x},${a.y}) · tuned (${b.x},${b.y})`), h('div', null, `Total wait this day: ${number(sa.totalWait)} s → ${number(sb.totalWait)} s`), h('div', null, `Maximum queue: ${sa.maxQueue} → ${sb.maxQueue}`));
}
async function loadDay(profile: string) {
  const revision = ++loadRevision;
  const choice = selected.replays.find(day => day.profile === profile) ?? selected.replays[0];
  replay = null;
  el('error').textContent = 'Loading matched factory traces…';
  el('error').hidden = false;
  el('day-meta').textContent = 'Loading the same demand day for both models…';
  el('day-scores').replaceChildren();
  el<HTMLAnchorElement>('replay-link').removeAttribute('href');
  try {
    const loaded = await getJson<OptimizerReplay>(choice.file);
    if (revision !== loadRevision) return;
    replay = loaded;
    el('error').hidden = true;
    world.setBundle(loaded);
    world.preset('overview', false);
    simTime = 0;
    endTime = playbackEnd(loaded.baseline.result.trace, loaded.improved.result.trace);
    el<HTMLInputElement>('time').max = String(endTime);
    el<HTMLSelectElement>('day').value = choice.profile;
    el('day-meta').textContent = `Same ${choice.profile} demand · seed ${choice.seed} · 100 packages on each side.`;
    el('scene-note').textContent = `${choice.profile.toUpperCase()} DEMAND · SEED ${choice.seed} · ONE SHARED CLOCK`;
    const a = loaded.baseline.result.metrics, b = loaded.improved.result.metrics;
    el('day-scores').replaceChildren(row('Objective ↓', number(a.objective), number(b.objective)), row('Makespan ↓', `${number(a.makespan)} s`, `${number(b.makespan)} s`), row('Damaged ↓', a.damaged, b.damaged), row('Shipped', `${a.shipped}/100`, `${b.shipped}/100`), row('Missorted ↓', a.missorts, b.missorts));
    el<HTMLAnchorElement>('replay-link').href = `./${choice.file}`;
    el('station').textContent = 'Select a machine in either 3D floor to compare its position and measured wait.';
    const url = new URL(location.href);
    url.searchParams.set('factory', selected.id); url.searchParams.set('day', choice.profile);
    history.replaceState(null, '', url);
    updateClock();
  } catch (error) {
    el('error').hidden = false;
    el('error').textContent = error instanceof Error ? error.message : 'Replay could not be loaded.';
  }
}
async function chooseFactory(id: string) {
  selected = catalog.cases.find(item => item.id === id) ?? catalog.cases.find(item => item.id === catalog.defaultCaseId)!;
  el<HTMLSelectElement>('factory').value = selected.id;
  el('day').replaceChildren(...selected.replays.map(day => h('option', { value: day.profile }, `${day.profile[0].toUpperCase()}${day.profile.slice(1)} · ${day.seed}`)));
  renderAggregate();
  await loadDay(new URLSearchParams(location.search).get('day') ?? catalog.defaultProfile);
}
el('factory').onchange = () => void chooseFactory(el<HTMLSelectElement>('factory').value);
el('day').onchange = () => void loadDay(el<HTMLSelectElement>('day').value);
el('play').onclick = () => { if (simTime >= endTime) simTime = 0; playing = !playing; updateClock(); };
el('restart').onclick = () => { simTime = 0; playing = true; updateClock(); };
el('end').onclick = () => { simTime = endTime; playing = false; updateClock(); };
el('overview').onclick = () => world.preset('overview');
el('speed').onchange = () => { speed = Number(el<HTMLSelectElement>('speed').value); };
el('time').oninput = () => { simTime = Number(el<HTMLInputElement>('time').value); playing = false; updateClock(); };
el('labels').onchange = () => el('scene').classList.toggle('hide-stations', !el<HTMLInputElement>('labels').checked);
function animate(now: number) {
  const dt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000)); lastFrame = now;
  if (replay) {
    if (playing) { simTime = Math.min(endTime, simTime + dt * speed); if (simTime === endTime) playing = false; }
    const frames = world.render(simTime, now / 1000);
    if (frames) world.setCounters(...frames.map(f => `shipped ${f.shipped}/100 · queued ${f.queued} · damaged ${f.damaged}`) as [string, string]);
    updateClock();
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
void (async () => {
  try {
    catalog = await getJson<Catalog>('catalog.json');
    el('factory').replaceChildren(...catalog.cases.map(item => h('option', { value: item.id }, `Factory ${item.id.replace('optimizer-test-building-', '')} · ${signedPercent(item.comparison.tunedVsBasePercent)}${item.id === catalog.defaultCaseId ? ' · median' : ''}`)));
    const base = catalog.overall.base, tuned = catalog.overall.tuned;
    el('overall').replaceChildren(row('Mean objective ↓', number(base.meanFinalObjective!), number(tuned.meanFinalObjective!)), row('Factories improved', `${base.objectiveImprovements}/20`, `${tuned.objectiveImprovements}/20`), row('Invalid proposals', `${base.budget.invalidActions}/60`, `${tuned.budget.invalidActions}/60`), row('Full goal', `${base.finalGoalPasses}/20`, `${tuned.finalGoalPasses}/20`));
    el('overall-note').textContent = `Paired result: tuned wins ${catalog.pairedWins.tuned}, base wins ${catalog.pairedWins.base}, ties ${catalog.pairedWins.ties}. Same three proposals per arm. This is a small synthetic benchmark.`;
    el('hash').textContent = `Grader ${catalog.graderHash.slice(0, 12)} · ${catalog.cases.length} factories · four final demand days each.`;
    await chooseFactory(new URLSearchParams(location.search).get('factory') ?? catalog.defaultCaseId);
  } catch (error) {
    el('error').hidden = false; el('error').textContent = error instanceof Error ? error.message : 'Comparison could not be loaded.';
  }
})();
