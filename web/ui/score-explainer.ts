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
    <p>${fmt(before)} → ${fmt(after)} is the average over 9 held-out days. The agents cut that penalty ${pct}%. It does not mean ${pct}% faster.${peak ? ` On the replayed day the floor clears in ${clock(peak.after)} instead of ${clock(peak.before)}, with ${peak.missorts} mis-sorts and ${peak.damaged} damaged.` : ''}</p>
    <p class="score-caveat">Fines are scoring weights, not real seconds. 14 damaged packages alone add ${fmt(14 * OBJECTIVE.damaged)} points.</p>`;
  return el;
}
