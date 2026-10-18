/** "What does this score mean?": the simulator's objective in plain terms. Weights mirror OBJECTIVE in src/sim/config.ts. */
import './score-explainer.css';
import { OBJECTIVE } from '../../src/sim/config';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export interface PeakDay { before: number; after: number; missorts: number; damaged: number }
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function createScoreExplanation(before: number, after: number, peak?: PeakDay): HTMLDetailsElement {
  const pct = Math.round((1 - after / before) * 100);
  const el = document.createElement('details');
  el.className = 'score-explainer';
  const rows: [string, string][] = [
    ['Time until the last package ships', '1 point per second'],
    ['Each mis-sorted package', `${fmt(OBJECTIVE.missort)} points`],
    ['Each damaged package', `${fmt(OBJECTIVE.damaged)} points`],
    ['Each unshipped package', `${fmt(OBJECTIVE.unshipped)} points`],
    ['Equipment cost', `1 point per $${OBJECTIVE.capexPerSecond}`],
  ];
  el.innerHTML = `<summary>What does this score mean?</summary>
    <p>One penalty number. Lower is better. It adds the time to clear the floor to fines for every mistake.</p>
    <table class="score-breakdown"><thead><tr><th>Counts</th><th>Adds</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
    <p>${fmt(before)} → ${fmt(after)} is the average over 9 validation days. The agents cut that penalty ${pct}%. It does not mean ${pct}% faster.${peak ? ` On the replayed day the floor clears in ${clock(peak.after)} instead of ${clock(peak.before)}, with ${peak.missorts} mis-sorts and ${peak.damaged} damaged.` : ''}</p>
    <p class="score-caveat">Fines are scoring weights, not real seconds. 14 damaged packages alone add ${fmt(14 * OBJECTIVE.damaged)} points.</p>
    <h4>What are the 6 training and 9 validation scenarios?</h4>
    <p>Each scenario is one simulated day with 100 packages. The three types describe the incoming workload:</p>
    <table class="score-breakdown score-scenarios"><thead><tr><th>Day type</th><th>Package arrivals</th><th>Training</th><th>Validation</th></tr></thead><tbody>
      <tr><th scope="row">Normal</th><td>Over 20 minutes; 10% fragile probability</td><td>2 days</td><td>3 days</td></tr>
      <tr><th scope="row">Peak</th><td>Over 5 minutes; 10% fragile probability</td><td>2 days</td><td>3 days</td></tr>
      <tr><th scope="row">Fragile-heavy</th><td>Over 20 minutes; 35% fragile probability</td><td>2 days</td><td>3 days</td></tr>
    </tbody></table>
    <p>Each day uses a different fixed random seed to vary arrival times, package sizes, destinations and fragile flags. Every layout faces the same repeatable days.</p>
    <p><strong>6 training days:</strong> agents test and compare candidate layouts. This does not train model weights.<br/><strong>9 validation days:</strong> a separate set checks whether to keep the best candidate. It must lower the average penalty by at least 1%, without losing a previously passed goal check.</p>
    <p class="score-caveat">Validation feedback guides later revisions, so these are development results, not an untouched final test.</p>`;
  return el;
}
