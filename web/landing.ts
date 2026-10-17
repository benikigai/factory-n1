/**
 * Landing page as an engineering drawing sheet. The hero is the recorded run replayed from its scored
 * traces; the inspection table ticks on the same clock; every number is read from recorded artifacts.
 */
import type { ReplayBundle } from "../src/replay.ts";
import { HERO_RUN, MEMORY_EVAL, REPO } from "./facts.ts";
import { createWarehouse } from "./world/warehouse.ts";
import { playbackEnd, traceMeta } from "./world/state.ts";

const $ = (id: string) => document.getElementById(id)!;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const drop = (a: number, b: number, d = 1) => `−${fmt((1 - b / a) * 100, d)}%`;
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
  baseline: { select: number; dodSelect: boolean };
  champion: { select: number; dodSelect: boolean };
  comparators: { label: string; select: number }[];
  usage: { calls: number; usd: number; promptTokens: number; cachedTokens: number };
  simEvals: number;
};
type MemResults = { n: number; wins: number; ties: number; losses: number };
type Spend = { totals: { returnedUsageInferenceUsd: number; youSearches: number; youSearchBaseUsd: number } };

($("repo-link") as HTMLAnchorElement).href = REPO;
($("nav-replay") as HTMLAnchorElement).href = `./replay.html?run=${HERO_RUN}`;

const [bundle, summary, a7, a7replay, mem, spend] = await Promise.all([
  json<ReplayBundle>(`./runs/${HERO_RUN}/replay.json`),
  json<Summary>(`./runs/${HERO_RUN}/summary.json`),
  json<Summary>(`./runs/live-a-7/summary.json`),
  json<ReplayBundle>(`./runs/live-a-7/replay.json`),
  json<MemResults>(`./runs/${MEMORY_EVAL}/results.json`),
  json<Spend>(`./evidence/spend-accounting.json`),
]);

/* ---------- Headline numbers ---------- */
if (summary) {
  $("h-pct").textContent = `${fmt((1 - summary.champion.select / summary.baseline.select) * 100)}%`;
  $("h-cost").textContent = `${fmt(summary.usage.usd * 100)}¢`;
}

/* ---------- Hero: the real scored replay on the drawing sheet ---------- */
const speedOverride = Number(new URLSearchParams(location.search).get("speed"));
const playback = { t: 0, end: 1, playing: true, speed: Number.isFinite(speedOverride) && speedOverride > 0 ? speedOverride : 16 };
if (bundle) {
  const world = createWarehouse($("hero-scene"), () => {}, { paper: true });
  world.setBundle(bundle);
  world.preset("overview", false);
  new ResizeObserver(() => world.preset("overview", false)).observe($("hero-scene"));
  playback.end = Math.max(1, playbackEnd(bundle.baseline.result.trace, bundle.improved.result.trace));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    playback.playing = false;
    playback.t = playback.end;
  }
  $("hero-clock").innerHTML = `<span>T+ <b id="clock-t">00:00</b> / ${mmss(playback.end)} · ${playback.speed}× replay</span><button id="clock-btn" type="button">${playback.playing ? "Pause" : "Play"}</button>`;
  $("clock-btn").addEventListener("click", () => {
    playback.playing = !playback.playing;
    $("clock-btn").textContent = playback.playing ? "Pause" : "Play";
  });

  // Goal checks, evaluated from the exact traces at the current replay time.
  const sides = [bundle.baseline, bundle.improved].map((s) => ({ s, meta: traceMeta(s.result.trace, s.layout) }));
  let frames: ReturnType<typeof world.render> = null;
  const inspect = () => {
    const t = playback.t;
    const done = t >= playback.end - 0.5;
    const cell = (v: string, ok: boolean | null) => `<td><span class="v">${v}</span><span class="st ${ok === null ? "run" : ok ? "pass" : "fail"}">${ok === null ? "—" : ok ? "PASS" : "FAIL"}</span></td>`;
    const rows: [string, (i: number) => string][] = [
      ["All 100 packages ship", (i) => {
        const fin = sides[i].s.result.metrics.shipped;
        const now = done ? fin : frames ? frames[i].shipped : 0;
        return cell(`${now}/100`, done ? fin === 100 : now === 100 ? true : null);
      }],
      ["Clears within 25 min", (i) => {
        const ms = sides[i].s.result.metrics.makespan;
        return cell(t >= ms ? mmss(ms) : mmss(Math.min(t, 1500)), t >= ms ? ms <= 1500 : t > 1500 ? false : null);
      }],
      ["At most 1 mis-sort", (i) => {
        const n = sides[i].meta.missortedAt.filter((x) => x !== null && x <= t).length;
        return cell(String(n), n > 1 ? false : done ? true : null);
      }],
      ["Nothing damaged", (i) => {
        const n = sides[i].meta.damagedAt.filter((x) => x !== null && x <= t).length;
        return cell(String(n), n > 0 ? false : done ? true : null);
      }],
    ];
    $("dod").innerHTML = `<tr><th>Check</th><th>Rev 0</th><th>Rev 11</th></tr>` + rows.map(([k, f]) => `<tr><td>${k}</td>${f(0)}${f(1)}</tr>`).join("");
    $("clock-t").textContent = mmss(t);
  };

  let last = performance.now();
  let lastUi = 0;
  const tick = (now: number) => {
    // The first frame timestamp can precede initialization's performance.now().
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (playback.playing) {
      playback.t += dt * playback.speed;
      if (playback.t > playback.end + 6) playback.t = 0; // hold the final state briefly, then loop
    }
    frames = world.render(Math.min(playback.t, playback.end), now / 1000);
    if (frames && now - lastUi > 150) {
      lastUi = now;
      const [a, b] = frames;
      const count = (f: typeof a) => `${f.shipped}/100 shipped · <span class="${f.damaged ? "bad" : ""}">${f.damaged} damaged</span>`;
      $("cnt-0").innerHTML = count(a);
      $("cnt-1").innerHTML = count(b);
      inspect();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
} else {
  $("hero-scene").innerHTML = `<p class="missing">Recorded run not found.</p>`;
}

/* ---------- Title block ---------- */
if (bundle && summary) {
  const rows: [string, string][] = [
    ["Project", "Factory N+1 · fulfillment floor A · 24 × 14 cells"],
    ["Revision", `11 <small>(continued from rev 7)</small>`],
    ["Drawn by", "NVIDIA Nemotron 3.5 Super VL on Crusoe"],
    ["Checked by", `Frozen simulator · SIM ${esc(bundle.simVersion)} · <code>${esc(bundle.graderHash.slice(0, 8))}</code>`],
    ["Result", `${fmt(summary.baseline.select)} → ${fmt(summary.champion.select)} <b>${drop(summary.baseline.select, summary.champion.select)}</b>`],
    ["Cost", `$${summary.usage.usd.toFixed(3)} · ${summary.usage.calls} model calls`],
  ];
  $("titleblock").innerHTML =
    rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("") +
    `<tr class="status"><th>Status</th><td><span class="stamp ${summary.champion.dodSelect ? "ok" : "no"}">${summary.champion.dodSelect ? "Approved" : "Not approved"}</span><small>${summary.champion.dodSelect ? "goal met on all 15 development days" : "goal not met"}</small></td></tr>`;
}

/* ---------- Revision history ---------- */
if (bundle && summary && a7) {
  const b = bundle.baseline.result.metrics;
  const c = bundle.improved.result.metrics;
  const m7 = a7replay?.improved.result.metrics;
  const peak = (m: { missorts: number; damaged: number }) => `${m.missorts} · ${m.damaged}`;
  const st = (cls: string, text: string) => `<span class="st ${cls}">${text}</span>`;
  type Rev = { n: string; change: string; by: string; obj: number; delta?: string; peak: string; goal: string; current?: boolean };
  const rows: Rev[] = [
    { n: "0", change: "Original floor", by: "", obj: summary.baseline.select, peak: peak(b), goal: st("fail", "FAIL") },
    { n: "7", change: "Zone-dedicated pack stations beside each dock", by: "Quality designer", obj: a7.champion.select, delta: drop(summary.baseline.select, a7.champion.select, 0), peak: m7 ? peak(m7) : "—", goal: st(a7.champion.dodSelect ? "pass" : "fail", a7.champion.dodSelect ? "PASS" : "FAIL") },
    { n: "8–10", change: "Nothing accepted: designers mis-measured route lengths, calling a 17-cell leg 12", by: "Route designer", obj: a7.champion.select, peak: "—", goal: st("hold", "HELD") },
    { n: "11", change: "pack-B moved 3 cells inland, so every conveyor leg is ≤ 12 cells", by: "Route designer with the measure_legs ruler", obj: summary.champion.select, delta: drop(summary.baseline.select, summary.champion.select, 0), peak: peak(c), goal: st(summary.champion.dodSelect ? "pass" : "fail", summary.champion.dodSelect ? "APPROVED" : "FAIL"), current: true },
  ];
  $("revtable").innerHTML =
    `<thead><tr><th>Rev</th><th>Change</th><th>Objective</th><th class="hide-sm">Peak day: mis-sorts · damaged</th><th>Goal</th></tr></thead><tbody>` +
    rows.map((r) => `<tr class="${r.current ? "current" : ""}"><td class="n">${r.n}</td><td>${esc(r.change)}${r.by ? `<span class="by">${esc(r.by)}</span>` : ""}</td><td class="m">${fmt(r.obj)}${r.delta ? `<small>${r.delta}</small>` : ""}</td><td class="m hide-sm">${r.peak}</td><td>${r.goal}</td></tr>`).join("") +
    `</tbody>`;
  $("rev-note").innerHTML =
    "Objective is the average over 9 validation days the designers never saw. Rev 11 continued from rev 7 after the designers got a ruler; the final test split stays locked. " +
    `<a href="./evidence/zero-damage-feasibility.md">Why it took a ruler</a>`;
}

/* ---------- Inspection stamps ---------- */
{
  const heur = a7?.comparators.find((x) => x.label.startsWith("Code heuristic"));
  const rand = a7?.comparators.find((x) => x.label.startsWith("Random"));
  const stamp = (tag: string, big: string, body: string, href: string) =>
    `<article class="proof"><p class="label">${tag}</p><div class="big">${big}</div><p>${body}</p><a href="${href}">Evidence</a></article>`;
  $("stamps").innerHTML = [
    a7 && heur && rand
      ? stamp("Equal budget", fmt(a7.champion.select), `Rev 7, against ${fmt(heur.select)} for a one-line code fix and ${fmt(rand.select)} for blind random search, each given the same ${a7.simEvals} simulator runs.`, "./replay.html?run=live-a-7")
      : "",
    stamp("Claims checked", "4/7 → 0/7", "Designer predictions the simulator refuted, before and after designers could test drafts. When a model reported a simulator run that never happened, the grader caught it.", "./evidence/2026-10-17-live-roundtrip.md"),
    mem
      ? stamp("Negative result, shown", `${mem.wins} of ${mem.n}`, `Shared memory won none of ${mem.n} pre-registered tests on fresh factories. We report it rather than tune it away.`, "./evidence/memory-eval-valid.md")
      : "",
  ].join("");
}

/* ---------- Bill of materials ---------- */
{
  const cache = summary ? `${fmt((summary.usage.cachedTokens / summary.usage.promptTokens) * 100)}% prompt-cache hits` : "";
  const rows: [string, string, string][] = [
    ["Crusoe Managed Inference", "Serves every model call and caches the shared-memory prefix", `${spend ? `$${spend.totals.returnedUsageInferenceUsd.toFixed(3)} all inference today` : ""}${cache ? `<small>${cache} in rev 11</small>` : ""}`],
    ["NVIDIA Nemotron 3.5", "Super VL designs through typed tool calls; Lightning researches and runs isolated tests", "27 ruler calls → 1 approved move<small>0 refuted claims in rev 11</small>"],
    ["You.com Search API", "Grounded research with search receipts", `${spend ? spend.totals.youSearches : "—"} live searches<small>every citation matched to a returned URL</small>`],
    ["Frozen simulator", "Ours. Scores every change; agents never grade themselves", bundle ? `SIM ${esc(bundle.simVersion)} · ${esc(bundle.graderHash.slice(0, 8))}<small>audited before use</small>` : "—"],
  ];
  $("bomtable").innerHTML =
    `<thead><tr><th>Part</th><th class="hide-sm">Role</th><th>Measured</th></tr></thead><tbody>` +
    rows.map(([part, role, m]) => `<tr><td><b>${part}</b></td><td class="hide-sm">${role}</td><td class="m">${m}</td></tr>`).join("") +
    `</tbody>`;
}

/* ---------- Evidence and footer ---------- */
const ev: [string, string][] = [
  [`./replay.html?run=${HERO_RUN}`, "Rev 11 replay, with receipts"],
  [`./replay.html?run=${HERO_RUN}&view=agents`, "Agent team view"],
  ["./replay.html?run=live-a-7", "Rev 7 replay (equal-budget proof)"],
  ["./evidence/independent-verification-live-a-11.md", "Independent re-score of rev 11"],
  ["./evidence/zero-damage-feasibility.md", "Why it took a ruler"],
  ["./evidence/memory-eval-valid.md", "Memory test (negative)"],
  ["./evidence/2026-10-17-live-roundtrip.md", "The faked simulator run"],
  ["./evidence/spend-accounting.json", "Spend accounting"],
  ["./evidence/spec-as-built.md", "Spec, as built"],
  [REPO, "Source on GitHub"],
];
$("evlist").innerHTML = ev.map(([h, k]) => `<a href="${h}"${h.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(k)}</a>`).join("");
$("foot-note").textContent =
  `Every number on this page is read from recorded runs. ` +
  (spend ? `Project spend today: $${spend.totals.returnedUsageInferenceUsd.toFixed(3)} inference + $${spend.totals.youSearchBaseUsd.toFixed(2)} search. ` : "") +
  "Built at the Crusoe × Cerebral Valley Recursive Agents Hackathon, 2026-10-17.";

if (location.hash) void document.fonts.ready.then(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant" }));

// Localhost-only live control; compiled out of production builds.
if (import.meta.env.DEV) void import("./run-live.ts").then((m) => m.mountRunLive(document.querySelector(".hero .wrap")!));
