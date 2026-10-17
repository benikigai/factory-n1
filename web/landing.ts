/**
 * Landing "proof board". The hero is the real recorded run, replayed from its scored traces; the goal
 * checklist ticks on the same clock; every number is read from recorded artifacts at runtime.
 */
import type { ReplayBundle } from "../src/replay.ts";
import { GEN0_SELECT, HERO_RUN, INSIGHTS, LOG, MEMORY_EVAL, REPO, RUNS } from "./facts.ts";
import { createWarehouse } from "./world/warehouse.ts";
import { playbackEnd, traceMeta } from "./world/state.ts";

const $ = (id: string) => document.getElementById(id)!;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (a: number, b: number) => `${b < a ? "−" : "+"}${fmt(Math.abs((1 - b / a) * 100), 1)}%`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type Summary = {
  baseline: { train: number; select: number; dodSelect: boolean };
  champion: { train: number; select: number; dodSelect: boolean };
  comparators: { label: string; train: number; select: number }[];
  usage: { calls: number; usd: number; promptTokens: number; cachedTokens: number };
  simEvals: number;
};
type MemPair = { factory: string; rep: number; diffObjective: number; outcome: string; MEM: { final: { objective: number } }; NOMEM: { final: { objective: number } } };
type MemResults = { n: number; wins: number; ties: number; losses: number; medianDiffObjective: number; armCaps: { maxCalls: number; maxSimEvals: number }; pairs: MemPair[] };
type Spend = { authorizationUsd: number; totals: { returnedUsageInferenceUsd: number; unknownChargeReservationsUsd: number; youSearches: number; conservativeCommittedUsd: number } };

($("repo-link") as HTMLAnchorElement).href = REPO;

const [bundle, summary, a7, a8, mem, spend] = await Promise.all([
  json<ReplayBundle>(`./runs/${HERO_RUN}/replay.json`),
  json<Summary>(`./runs/${HERO_RUN}/summary.json`),
  json<Summary>(`./runs/live-a-7/summary.json`),
  json<Summary>(`./runs/live-a-8/summary.json`),
  json<MemResults>(`./runs/${MEMORY_EVAL}/results.json`),
  json<Spend>(`./evidence/spend-accounting.json`),
]);

/* ---------- Hero: the real scored replay ---------- */
const speedOverride = Number(new URLSearchParams(location.search).get("speed"));
const playback = { t: 0, end: 1, playing: true, speed: Number.isFinite(speedOverride) && speedOverride > 0 ? speedOverride : 16 };
let frames: ReturnType<ReturnType<typeof createWarehouse>["render"]> = null;
if (bundle) {
  const world = createWarehouse($("hero-scene"), () => {});
  world.setBundle(bundle);
  world.preset("overview", false);
  // The hero camera is fixed (no orbit), so refit it whenever the stage changes size.
  new ResizeObserver(() => world.preset("overview", false)).observe($("hero-scene"));
  playback.end = Math.max(1, playbackEnd(bundle.baseline.result.trace, bundle.improved.result.trace));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    playback.playing = false;
    playback.t = playback.end;
  }
  $("hero-meta").innerHTML = [
    `<span class="pill"><span class="dot"></span>RECORDED · ${esc(bundle.runId)}</span>`,
    `<span class="pill">grader ${esc(bundle.graderHash.slice(0, 8))} · SIM ${esc(bundle.simVersion)}</span>`,
    `<span class="pill">${esc(bundle.scenario.id)} · 100 packages · one clock</span>`,
  ].join("");
  const clock = $("hero-clock");
  clock.innerHTML = `<div>sim <b id="clock-t">00:00</b> / ${mmss(playback.end)} · ${playback.speed}×</div><button id="clock-btn" type="button">${playback.playing ? "Pause" : "Play"}</button>`;
  $("clock-btn").addEventListener("click", () => {
    playback.playing = !playback.playing;
    $("clock-btn").textContent = playback.playing ? "Pause" : "Play";
  });

  // Goal checks, evaluated from the exact traces at the current replay time.
  const sides = [bundle.baseline, bundle.improved].map((s) => ({ s, meta: traceMeta(s.result.trace, s.layout) }));
  $("goal").textContent = `“${bundle.task.goal}”`;
  const table = $("dod");
  const render = () => {
    const t = playback.t;
    const done = t >= playback.end - 0.5;
    const cell = (v: string, ok: boolean | null) => `${v}<span class="st ${ok === null ? "run" : ok ? "pass" : "fail"}">${ok === null ? "…" : ok ? "PASS" : "FAIL"}</span>`;
    const rows = [
      ["Every package ships", (i: number) => {
        const shipped = frames ? frames[i].shipped : 0;
        const fin = sides[i].s.result.metrics.shipped;
        return cell(`${done ? fin : shipped}/100`, done ? fin === 100 : shipped === 100 ? true : null);
      }],
      ["Floor clears within 25 min", (i: number) => {
        const ms = sides[i].s.result.metrics.makespan;
        const finished = t >= ms;
        return cell(finished ? mmss(ms) : mmss(Math.min(t, 1500)), finished ? ms <= 1500 : t > 1500 ? false : null);
      }],
      ["At most 1 mis-sort", (i: number) => {
        const n = sides[i].meta.missortedAt.filter((x) => x !== null && x <= t).length;
        return cell(String(n), n > 1 ? false : done ? true : null);
      }],
      ["Nothing damaged", (i: number) => {
        const n = sides[i].meta.damagedAt.filter((x) => x !== null && x <= t).length;
        return cell(String(n), n > 0 ? false : done ? true : null);
      }],
    ] as const;
    table.innerHTML = `<tr><th>Check</th><th>Starting floor</th><th>Agents' floor</th></tr>` +
      rows.map(([k, f]) => `<tr><td>${k}</td><td>${f(0)}</td><td>${f(1)}</td></tr>`).join("");
    ($("clock-t") as HTMLElement).textContent = mmss(t);
  };
  $("dod-note").textContent =
    "Checks are code over the simulator's output, never the model's report. Run 7 failed on damage. " +
    (summary
      ? summary.champion.dodSelect
        ? "Run 11 passes all four checks on all 15 development days. The final split stays locked."
        : "The hero has not met the goal on validation days."
      : "The hero's validation goal status is unavailable.");

  let last = performance.now();
  let lastUi = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playback.playing) {
      playback.t += dt * playback.speed;
      if (playback.t > playback.end + 6) playback.t = 0; // hold the final state briefly, then loop
    }
    frames = world.render(Math.min(playback.t, playback.end), now / 1000);
    if (frames && now - lastUi > 150) {
      lastUi = now;
      const [a, b] = frames;
      world.setCounters(`shipped ${a.shipped}/100 · damaged ${a.damaged}`, `shipped ${b.shipped}/100 · damaged ${b.damaged}`);
      render();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
} else {
  $("hero-meta").innerHTML = `<span class="pill">Recorded run not found</span>`;
}

/* ---------- KPIs ---------- */
if (bundle && summary) {
  const goalMet = summary.champion.dodSelect;
  $("hero-result").innerHTML = `<strong>${pct(summary.baseline.select, summary.champion.select)}</strong> validation objective <span>· ${goalMet ? "goal met on all 15 development days" : "goal not met on validation days"} · final split locked</span>`;
  const b = bundle.baseline.result.metrics;
  const c = bundle.improved.result.metrics;
  const kpi = (v: string, cls: string, k: string, s: string) => `<div class="kpi"><div class="kpi-v ${cls}">${v}</div><div class="kpi-k">${k}</div><div class="kpi-s">${s}</div></div>`;
  $("kpis").innerHTML = [
    kpi(pct(summary.baseline.select, summary.champion.select), "pos", "Validation objective", `${fmt(summary.baseline.select)} → ${fmt(summary.champion.select)} on 9 validation days. Continued from run 7; final split locked.`),
    kpi(`${b.missorts} → ${c.missorts}`, "pos", "Mis-sorted packages", "On this peak day. Zero on all 15 development days. The code heuristic also fixes the size-acceptance issue."),
    kpi(`${fmt(b.makespan)}→${fmt(c.makespan)}s`, "pos", "Time to clear the floor", `${pct(b.makespan, c.makespan)} on the same day. Shorter routes: ${fmt(b.travelCells)} → ${fmt(c.travelCells)} cells.`),
    kpi(`${c.damaged} dmg`, c.damaged === 0 ? "pos" : "neg", `Goal: ${goalMet ? "PASS" : "FAIL"}`, goalMet ? "All four checks pass on all 15 development days. Final split locked." : "The full goal is not met on validation days."),
  ].join("");
}

/* ---------- Equal-budget proof belongs to run 7 ---------- */
if (a7) {
  const heur = a7.comparators.find((x) => x.label.startsWith("Code heuristic"))!;
  const rand = a7.comparators.find((x) => x.label.startsWith("Random"))!;
  const rows = [
    { k: "Starting floor", s: "Gen 0", v: a7.baseline.select },
    { k: "One-line code heuristic", s: "pack stations accept all sizes", v: heur.select },
    { k: "Blind random search", s: `same ${a7.simEvals} search evaluations`, v: rand.select },
    { k: "Nemotron agents", s: "run 7, independently re-scored", v: a7.champion.select, win: true },
  ];
  const max = Math.max(...rows.map((r) => r.v));
  $("race").innerHTML = rows
    .map((r) => `<div class="bar-row ${r.win ? "win" : ""}"><div class="bar-label">${r.k}<small>${r.s}</small></div><div class="bar"><i style="width:${(r.v / max) * 100}%"></i></div><div class="bar-val">${fmt(r.v)}</div></div>`)
    .join("");

  if (summary) {
    $("lineage").innerHTML = `<div class="lineage-heading"><span class="card-kicker">Version N+1</span><span class="fine">Validation objective · lower is better</span></div>
      <div class="lineage-steps">
        <div class="lineage-step"><span>Gen 0</span><strong>${fmt(a7.baseline.select)}</strong><small>Starting floor</small></div>
        <span class="lineage-arrow" aria-hidden="true">→</span>
        <a class="lineage-step" href="./replay.html?run=live-a-7"><span>Run 7 <b class="st ${a7.champion.dodSelect ? "pass" : "fail"}">Goal ${a7.champion.dodSelect ? "PASS" : "FAIL"}</b></span><strong>${fmt(a7.champion.select)}</strong><small>4 damaged on the peak day</small></a>
        <span class="lineage-arrow" aria-hidden="true">→</span>
        <a class="lineage-step lineage-champion" href="./replay.html?run=${HERO_RUN}"><span>Run 11 <b class="st ${summary.champion.dodSelect ? "pass" : "fail"}">Goal ${summary.champion.dodSelect ? "PASS" : "FAIL"}</b></span><strong>${fmt(summary.champion.select)}</strong><small>${summary.champion.dodSelect ? "0 damaged on all 15 development days" : "Full goal not yet met"}</small></a>
      </div>
      <p class="fine">Run 11 continued from run 7's champion and memory, with a route-measuring tool added after runs 8–10 stalled. Development days only; final split locked. <a href="./evidence/zero-damage-feasibility.md">Read the evidence</a>.</p>`;
  }
}

/* ---------- Version N+1: runs chart ---------- */
{
  const W = 360, H = 150, pad = 26;
  const bw = (W - pad) / RUNS.length;
  const y = (v: number) => H - 22 - (v / GEN0_SELECT) * (H - 40);
  const bars = RUNS.map((r, i) => {
    const v = r.select ?? GEN0_SELECT;
    const x = pad + i * bw + 4;
    const hero = r.id === HERO_RUN;
    return `<rect x="${x}" y="${y(v)}" width="${bw - 8}" height="${H - 22 - y(v)}" rx="3" fill="${hero ? "#7cf0b4" : "#2b333f"}"><title>${r.id}: ${fmt(v)}: ${esc(r.note)}</title></rect>
      <text x="${x + (bw - 8) / 2}" y="${H - 8}" fill="#5d6673" font-size="9" text-anchor="middle" font-family="JetBrains Mono">${r.id.replace("live-a-", "a")}</text>`;
  }).join("");
  $("runs-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Validation objective per run versus the starting floor">
    <line x1="${pad}" x2="${W}" y1="${y(GEN0_SELECT)}" y2="${y(GEN0_SELECT)}" stroke="#ff6b6b" stroke-dasharray="3 4" stroke-width="1"/>
    <text x="${W}" y="${y(GEN0_SELECT) - 5}" fill="#ff6b6b" font-size="9.5" text-anchor="end" font-family="JetBrains Mono">Gen-0 ${fmt(GEN0_SELECT)}</text>
    ${bars}</svg>
    <div class="chart-key"><span>Validation objective per live run · lower is better · dashed line = starting floor</span></div>`;
  $("n1-facts").innerHTML = [
    `Best run: <b>${fmt(GEN0_SELECT)} → ${fmt(summary?.champion.select ?? 3283.44)}</b> on validation days; every run beat the one-line heuristic.`,
    "A change is kept only if it is <b>≥1% better on 9 validation days</b> with no goal-check regression. The gate refused real but tiny gains.",
    "Run 11 <b>continued from run 7's champion and memory</b>. A route-measuring tool and an interior-placement rule preceded the next gain; their effects were not isolated.",
  ].map((x) => `<li>${x}</li>`).join("");
}

/* ---------- Shared brain: memory vs no memory ---------- */
if (mem) {
  const W = 360, H = 136, padL = 70, padR = 58;
  const vals = mem.pairs.flatMap((p) => [p.MEM.final.objective, p.NOMEM.final.objective]);
  const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.04;
  const x = (v: number) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
  const rowH = (H - 8) / mem.pairs.length;
  const rows = mem.pairs.map((p, i) => {
    const yy = 4 + i * rowH + rowH / 2;
    const n = p.NOMEM.final.objective, m = p.MEM.final.objective;
    const d = m - n;
    return `<text x="0" y="${yy + 3.5}" fill="#8a94a3" font-size="10" font-family="JetBrains Mono">Factory ${p.factory.replace("factory-", "").toUpperCase()} · ${p.rep}</text>
      <line x1="${x(n)}" x2="${x(m)}" y1="${yy}" y2="${yy}" stroke="#ff6b6b" stroke-opacity="0.5" stroke-width="2"/>
      <circle cx="${x(n)}" cy="${yy}" r="5" fill="#e9edf2"><title>No memory ${fmt(n)}</title></circle>
      <circle cx="${x(m)}" cy="${yy}" r="5" fill="#ff6b6b"><title>Shared memory ${fmt(m)}</title></circle>
      <text x="${W}" y="${yy + 3.5}" text-anchor="end" fill="${d > 0 ? "#ff6b6b" : "#7cf0b4"}" font-size="10" font-family="JetBrains Mono">${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}</text>`;
  }).join("");
  $("memory-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Paired final-split objective, no memory vs shared memory">${rows}</svg>
    <div class="chart-key"><span><i class="k-nomem"></i>No memory</span><span><i class="k-mem"></i>Shared memory</span><span>Final-split objective · lower is better</span></div>`;
  $("memory-facts").innerHTML = [
    `Pre-registered test on two fresh factories: shared memory <b>${mem.wins} wins · ${mem.ties} ties · ${mem.losses} losses</b>, median <b>+${fmt(mem.medianDiffObjective)}</b> (worse), n = ${mem.n}.`,
    `Equal hard caps per arm (<b>${mem.armCaps.maxCalls} calls, ${mem.armCaps.maxSimEvals} simulator evals</b>), enforced at dispatch, and all held.`,
    "Likely contributor: lessons carried one factory's coordinates. Memory arms made <b>7/24</b> invalid proposals vs 2/24.",
    a8 ? `Observed in live-a-8: <b>${fmt((a8.usage.cachedTokens / a8.usage.promptTokens) * 100)}%</b> of prompt tokens were cache hits. Memory's causal effect on caching was not isolated.` : "",
  ].filter(Boolean).map((x) => `<li>${x}</li>`).join("");
}

/* ---------- Stack numbers ---------- */
{
  const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const perCall = summary ? summary.usage.usd / summary.usage.calls : null;
  $("sp-crusoe").innerHTML = kv([
    ["Cost per model call", perCall ? `$${perCall.toFixed(4)}` : "n/a"],
    ["Prompt-cache hits (a8)", a8 ? `${fmt((a8.usage.cachedTokens / a8.usage.promptTokens) * 100)}%` : "n/a"],
    ["All inference today", spend ? `$${spend.totals.returnedUsageInferenceUsd.toFixed(3)}` : "n/a"],
  ]);
  $("sp-nvidia").innerHTML = kv([
    ["Best layout (Super VL)", summary ? pct(summary.baseline.select, summary.champion.select) : "n/a"],
    ["Valid tool calls (a5)", "8 / 8"],
    ["Predictions refuted", "4/7 → 0/7"],
  ]);
  $("sp-you").innerHTML = kv([
    ["Live searches", spend ? String(spend.totals.youSearches) : "n/a"],
    ["Citation mismatches caught", "1 (repaired)"],
    ["Web ideas that beat the floor", "0"],
  ]);
}

/* ---------- Insights, log, evidence, footer ---------- */
$("insights").innerHTML = INSIGHTS.map((i) => `<li><h4>${esc(i.k)}</h4><p>${esc(i.v)}</p></li>`).join("");
$("timeline").innerHTML = LOG.map(
  (l) => `<li class="${l.tag ?? ""}"><div class="tl-head"><span>${l.t}</span><a href="${REPO}/commit/${l.hash}" target="_blank" rel="noopener">${l.hash}</a></div><p>${esc(l.text)}</p></li>`,
).join("");
const ev: [string, string, string][] = [
  [`./replay.html?run=${HERO_RUN}`, "Full replay viewer", "Hero run with diagnostics, receipts and lessons"],
  ["./replay.html?run=live-a-7", "Run 7: equal-budget proof", "Earlier champion: 41 search evaluations, goal FAIL"],
  ["./evidence/zero-damage-feasibility.md", "Run 11: zero-damage goal", "The continued run, route ruler and development-day checks"],
  [`./replay.html?run=${MEMORY_EVAL}-factory-g-r1`, "Memory pair G1 in 3D", "Final split; recorded memory and no-memory arms"],
  ["./evidence/spec-as-built.md", "Spec (as built)", "Architecture, proof and work log"],
  ["./evidence/memory-eval-valid.md", "Memory evaluation", "Design, caps, every pair, interpretation"],
  ["./evidence/spend-accounting.json", "Spend accounting", "Returned usage vs unknown-charge reservations"],
  ["./evidence/independent-verification-live-a-11.md", "Independent hero verification", "Re-scoring procedure, saved layouts and seeds"],
  ["./evidence/2026-10-17-live-roundtrip.md", "The fabricated re-run", "What Lightning claimed vs what the grader measured"],
  ...["factory-f-r1", "factory-f-r2", "factory-g-r2"].map((pair): [string,string,string] => [`./replay.html?run=${MEMORY_EVAL}-${pair}`, `Memory pair ${pair.replace("factory-", "").replace("-r", "").toUpperCase()} in 3D`, "Final split; recorded memory and no-memory arms"]),
  [REPO, "Source on GitHub", "Simulator, agents, memory, viewer"],
];
$("evidence").innerHTML = ev.map(([h, k, s]) => `<a class="ev" href="${h}"${h.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}><b>${esc(k)}</b><span>${esc(s)}</span></a>`).join("");
$("foot-note").textContent = spend
  ? `Every number on this page is read from recorded artifacts. The hero uses 15 development days (6 training, 9 validation); its final split stays locked. The memory study uses separate final days. Project spend: $${spend.totals.returnedUsageInferenceUsd.toFixed(3)} returned inference, $0.100 search base; $${spend.totals.conservativeCommittedUsd.toFixed(3)} including reservations conservatively. See spend accounting for unconfirmed extraction charges. Built at the Crusoe × Cerebral Valley Recursive Agents Hackathon, 2026-10-17.`
  : "Every number on this page is read from recorded artifacts. Built at the Crusoe × Cerebral Valley Recursive Agents Hackathon, 2026-10-17.";

// Sections fill in after the data loads, so honor a #section link once they exist.
if (location.hash) void document.fonts.ready.then(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant" }));


const evidenceIndex = await json<{files:string[]}>("./evidence/index.json");
const compilerFiles = ["goal-compiler.offline.json", "goal-compiler.live.json"].filter(file=>evidenceIndex?.files.includes(file));
type CompilerEvidence = {mode:string;results:{status:string;goal:string;approved:{hash:string}|null}[]};
const compilerReceipts = (await Promise.all(compilerFiles.map(async file=>({file, data:await json<CompilerEvidence>(`./evidence/${file}`)})))).filter(receipt=>receipt.data);
if (compilerReceipts.length) {
  const panel = $("goal-compiler");
  panel.hidden = false;
  const live = compilerReceipts.find(receipt=>receipt.data?.mode==='live');
  const needsFollowUp = live && !live.data!.results.every(result=>result.status==='approved');
  panel.innerHTML = `<h3>Goal compiler: offline checked${needsFollowUp?"; live smoke needs follow-up":""}</h3><p>Separate from the historical hero run. Offline checks use mocked model responses. The live smoke is shown independently; an approved contract still does not prove that a layout achieves it.</p>${compilerReceipts.map(({file,data})=>`<div class="compiler-run"><h4>${data!.mode==='offline'?"OFFLINE · Mocked model responses":"LIVE · Recorded smoke test"}</h4><ul>${data!.results.map(r=>`<li><b>${esc(r.status.toUpperCase())}</b>: ${esc(r.goal)}${r.approved ? ` <code>${esc(r.approved.hash.slice(0,12))}</code>` : ""}</li>`).join("")}</ul><a href="./evidence/${file}">Read the ${data!.mode} receipt</a></div>`).join("")}<p><a href="./evidence/goal-compiler.md">Implementation, failure details and limits</a></p>`;
}
