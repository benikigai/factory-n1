/** Right rail + HUD: provenance, before/after evidence, receipts, lessons. Pure DOM, rebuilt per bundle. */
import type { ReplayBundle, ReplaySide } from "../../src/replay.ts";
import type { RunMetrics } from "../../src/sim/types.ts";
import type { Frame } from "../world/state.ts";
import { fmtDelta, fmtNum, h, safeLink } from "./dom.ts";

const MODE_TEXT: Record<ReplayBundle["mode"], { label: string; hint: string }> = {
  synthetic: { label: "SYNTHETIC", hint: "Fixture with no model calls. Not an agent result." },
  recorded: { label: "RECORDED", hint: "Replay of a real run. Every number below came from the simulator." },
  live: { label: "LIVE", hint: "Run in progress. Reloads replay.json every 2 s." },
};

export function renderHud(badge: HTMLElement, meta: HTMLElement, b: ReplayBundle) {
  const m = MODE_TEXT[b.mode] ?? { label: String(b.mode).toUpperCase(), hint: "" };
  badge.textContent = m.label;
  badge.className = `mode mode-${b.mode}`;
  badge.title = m.hint;
  meta.replaceChildren(
    h("div", { class: "hud-line" },
      h("span", { class: "k" }, "run "), h("b", null, b.runId),
      h("span", { class: "k" }, "  sim v"), h("b", null, b.simVersion),
      h("span", { class: "k" }, "  grader "), h("code", { title: b.graderHash }, b.graderHash.slice(0, 10)),
      h("span", { class: "k" }, "  scenario "), h("b", null, `${b.scenario.id}`), h("span", { class: "k" }, ` (${b.scenario.profile}, seed ${b.scenario.seed})`),
    ),
    h("div", { class: "hud-goal" }, b.task.goal),
    ...(b.invalid ? [h("div", { class: "hud-invalid", role: "alert" }, `⚠ ${b.invalid}. Not evidence.`)] : []),
  );
}

export interface CounterEls {
  update(base: Frame, imp: Frame): void;
}

type Better = "lower" | "higher";
interface Row {
  label: string;
  base: number;
  imp: number;
  better: Better;
  digits?: number;
  fmt?: (n: number) => string;
}

function metricRows(a: RunMetrics, b: RunMetrics): Row[] {
  return [
    { label: "Shipped", base: a.shipped, imp: b.shipped, better: "higher", fmt: (n) => `${n}/${a.packages}` },
    { label: "Makespan (s)", base: a.makespan, imp: b.makespan, better: "lower" },
    { label: "Missorts", base: a.missorts, imp: b.missorts, better: "lower" },
    { label: "Damaged", base: a.damaged, imp: b.damaged, better: "lower" },
    { label: "Objective", base: a.objective, imp: b.objective, better: "lower", digits: 2 },
  ];
}

function deltaCell(r: Row) {
  const d = r.imp - r.base;
  const good = r.better === "lower" ? d < 0 : d > 0;
  const bad = r.better === "lower" ? d > 0 : d < 0;
  return h("td", { class: `num delta ${good ? "good" : bad ? "bad" : ""}` }, fmtDelta(d, r.digits ?? 0));
}

function rowEl(r: Row) {
  const f = r.fmt ?? ((n: number) => fmtNum(n, r.digits ?? 0));
  return h("tr", null, h("th", null, r.label), h("td", { class: "num" }, f(r.base)), h("td", { class: "num" }, f(r.imp)), deltaCell(r));
}

function dod(passed: boolean) {
  return h("span", { class: passed ? "pass" : "fail" }, passed ? "PASS" : "FAIL");
}

function sideHead(s: ReplaySide, cls: string) {
  return h("th", { class: `num col-${cls}`, title: s.label }, s.column ?? (cls === "base" ? "Baseline" : "Improved"));
}

export function renderRail(rail: HTMLElement, b: ReplayBundle): CounterEls {
  const A = b.baseline;
  const B = b.improved;

  // Live counters per floor.
  const live = (side: ReplaySide, cls: string) => {
    const shipped = h("b", null, "0");
    const queue = h("b", null, "0");
    const damaged = h("b", null, "0");
    const card = h("div", { class: `live-card live-${cls}` },
      h("div", { class: "live-title", title: side.label }, side.label),
      h("div", { class: "live-row" }, h("span", null, "shipped"), shipped, h("span", { class: "of" }, `/${side.result.trace.length}`)),
      h("div", { class: "live-row" }, h("span", null, "in queue"), queue),
      h("div", { class: "live-row" }, h("span", null, "damaged so far"), damaged),
    );
    return { card, shipped, queue, damaged };
  };
  const la = live(A, "base");
  const lb = live(B, "improved");

  const table = h("table", { class: "metrics" },
    h("thead", null, h("tr", null, h("th", null, `Scenario ${b.scenario.id}`), sideHead(A, "base"), sideHead(B, "improved"), h("th", { class: "num" }, "Δ"))),
    h("tbody", null,
      metricRows(A.result.metrics, B.result.metrics).map(rowEl),
      h("tr", { class: "sep" }, h("th", { colspan: "4" }, "Development / validation objectives (lower is better)")),
      rowEl({ label: "Train", base: A.train.objective, imp: B.train.objective, better: "lower", digits: 2 }),
      rowEl({ label: "Select", base: A.select.objective, imp: B.select.objective, better: "lower", digits: 2 }),
      h("tr", null, h("th", null, "DoD train"), h("td", { class: "num" }, dod(A.train.dodPassed)), h("td", { class: "num" }, dod(B.train.dodPassed)), h("td", null)),
      h("tr", null, h("th", null, "DoD select"), h("td", { class: "num" }, dod(A.select.dodPassed)), h("td", { class: "num" }, dod(B.select.dodPassed)), h("td", null)),
      ...(A.final && B.final
        ? [
            h("tr", { class: "sep" }, h("th", { colspan: "4" }, `Final split: locked fresh seeds (${A.final.scenarios} days), scored once`)),
            rowEl({ label: "Final objective", base: A.final.objective, imp: B.final.objective, better: "lower", digits: 2 }),
            rowEl({ label: "Final damaged (total)", base: A.final.damagedTotal, imp: B.final.damagedTotal, better: "lower", digits: 0 }),
            h("tr", null, h("th", null, "Zero damage, every day"), h("td", { class: "num" }, dod(A.final.zeroDamage)), h("td", { class: "num" }, dod(B.final.zeroDamage)), h("td", null)),
            h("tr", null, h("th", null, "DoD final"), h("td", { class: "num" }, dod(A.final.dodPassed)), h("td", { class: "num" }, dod(B.final.dodPassed)), h("td", null)),
          ]
        : []),
    ),
  );

  const rows = [
    { label: A.label, train: A.train.objective, select: A.select.objective, cls: "base" },
    { label: B.label, train: B.train.objective, select: B.select.objective, cls: "improved" },
    ...b.comparators.map((c) => ({ ...c, cls: "comparator" })),
  ];
  const bestSelect = Math.min(...rows.map((r) => r.select));
  const comps = h("table", { class: "metrics comps" },
    h("thead", null, h("tr", null, h("th", null, "Design (code-scored)"), h("th", { class: "num" }, "Train"), h("th", { class: "num" }, "Select"))),
    h("tbody", null, rows.map((r) =>
      h("tr", { class: `row-${r.cls}${r.select === bestSelect ? " best" : ""}` },
        h("th", { title: r.label }, r.label),
        h("td", { class: "num" }, fmtNum(r.train, 2)),
        h("td", { class: "num" }, fmtNum(r.select, 2)),
      ),
    )),
  );

  const accepted = b.accepted.length
    ? b.accepted.map((c) =>
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("span", { class: "gen" }, `Gen ${c.gen}`), h("b", null, c.designer), h("code", null, c.candidateId)),
          h("div", { class: "rationale" }, c.rationale),
          h("div", { class: "kv" }, "select ", h("b", null, fmtNum(c.selectBefore, 2)), " → ", h("b", null, fmtNum(c.selectAfter, 2)),
            h("span", { class: `delta ${c.selectAfter < c.selectBefore ? "good" : "bad"}` }, ` (${fmtDelta(c.selectAfter - c.selectBefore, 2)})`)),
          h("table", { class: "receipts" },
            h("thead", null, h("tr", null, h("th", null, "Edit receipt"), h("th", { class: "num", title: "Code-computed train objective change when this edit alone is applied to the previous champion" }, "Δ alone (code)"))),
            h("tbody", null, c.edits.map((e) => h("tr", null, h("td", null, h("code", null, e.edit)), h("td", { class: `num delta ${e.deltaAlone < 0 ? "good" : e.deltaAlone > 0 ? "bad" : ""}` }, fmtDelta(e.deltaAlone, 2))))),
          ),
          c.appliedLessons.length ? h("div", { class: "chips" }, h("span", { class: "k" }, "applied lessons "), c.appliedLessons.map((id) => h("span", { class: "chip" }, id))) : null,
          c.prediction ? h("div", { class: "kv small" }, "prediction: ", Object.entries(c.prediction).map(([k, v]) => `${k} ${fmtNum(v as number, 2)}`).join(", "), c.claimRefuted ? h("span", { class: "fail" }, "  REFUTED by sim") : null) : null,
        ),
      )
    : [h("div", { class: "empty" }, "No change accepted yet.")];

  const rj = b.rejected[0];
  const rejected = rj
    ? h("div", { class: "card rejected" },
        h("div", { class: "card-head" }, h("span", { class: "gen" }, `Gen ${rj.gen}`), h("b", null, rj.designer), h("code", null, rj.candidateId)),
        h("div", { class: "rationale" }, rj.rationale),
        h("div", { class: "reason" }, h("span", { class: "fail" }, "REJECTED "), rj.reason),
        rj.edits?.length ? h("ul", { class: "errs edits" }, rj.edits.map((e) => h("li", null, h("code", null, e)))) : null,
        rj.errors.length ? h("ul", { class: "errs" }, rj.errors.map((e) => h("li", null, e))) : null,
        h("div", { class: "kv small" }, "train objective: ", rj.trainObjective === null ? "— (failed validation)" : fmtNum(rj.trainObjective, 2)),
        b.rejected.length > 1 ? h("div", { class: "kv small" }, `+${b.rejected.length - 1} more rejected`) : null,
      )
    : h("div", { class: "empty" }, "No rejected candidates.");

  /** Conservative labels: an isolated test supports its exact edits, not the whole hypothesis text. */
  const lessonLabel = (l: ReplayBundle["lessons"][number]) => {
    if (!l.basis) return l.kind === "verified" ? "LEGACY label (pre-fix run)" : "EXTERNAL hypothesis";
    if (l.basis === "isolated-test") return "INTERVENTION IMPROVED · isolated test";
    if (l.basis === "observed-from-experiment") return "OBSERVED in accepted experiment";
    if (l.basis === "observed-from-rejected-experiment") return "OBSERVED in REJECTED experiment";
    if (l.status === "retired") return "TESTED · no improvement (retired)";
    return l.test ? "TESTED · no improvement" : "EXTERNAL hypothesis · untested";
  };
  const lessonClass = (l: ReplayBundle["lessons"][number]) =>
    l.basis === "isolated-test" || l.basis === "observed-from-experiment" ? "verified" : l.status === "retired" || l.basis === "observed-from-rejected-experiment" ? "retired" : "external";

  const lessons = b.lessons.length
    ? b.lessons.map((l) =>
        h("div", { class: `card lesson lesson-${l.kind}` },
          h("div", { class: "card-head" },
            h("span", { class: `kind kind-${lessonClass(l)}` }, lessonLabel(l)),
            h("code", null, l.id),
          ),
          h("div", { class: "lesson-text" }, l.text),
          l.sources.length ? h("ul", { class: "sources" }, l.sources.map((s) => h("li", null, s.title ? h("span", { class: "src-title" }, s.title + " ") : null, safeLink(s.url)))) : null,
          l.test
            ? h("div", { class: "kv small" },
                `Tested intervention (validation objective ${l.test.deltaSelect === null ? "n/a" : (l.test.deltaSelect > 0 ? "+" : "") + fmtNum(l.test.deltaSelect, 2)}). Supports these edits, not every claim in the source:`,
                h("ul", { class: "errs edits" }, l.test.edits.map((e) => h("li", null, h("code", null, e.edit), ` ${e.deltaAlone > 0 ? "+" : ""}${fmtNum(e.deltaAlone, 2)} alone`))),
              )
            : null,
          l.receipts?.length
            ? h("div", { class: "kv small" }, "Code receipts:",
                h("ul", { class: "errs edits" }, l.receipts.map((e) => h("li", null, h("code", null, e.edit), ` ${e.deltaAlone > 0 ? "+" : ""}${fmtNum(e.deltaAlone, 2)} alone`))),
              )
            : null,
          l.cited !== undefined ? h("div", { class: "kv small" }, `Cited by designers ${l.cited}× (${l.citedInAccepted ?? 0} in accepted proposals). Citations are not evidence.`) : null,
        ),
      )
    : [h("div", { class: "empty" }, "No lessons yet.")];

  const u = b.usage;
  const usage = h("div", { class: "usage" },
    `${u.calls} calls · $${u.usd.toFixed(2)} inference · ${u.searches} searches · $${u.searchUsd.toFixed(2)} search`,
  );

  rail.replaceChildren(
    h("section", { class: "live" }, la.card, lb.card),
    h("section", null, h("h3", null, "Before / after"), table),
    h("section", null, h("h3", null, "Comparators"), comps),
    h("section", null, h("h3", null, `Accepted changes (${b.accepted.length})`), accepted),
    h("section", null, h("h3", null, `Rejected (${b.rejected.length})`), rejected),
    h("section", null, h("h3", null, `Lessons (${b.lessons.length})`), lessons),
    h("section", null, h("h3", null, "Usage"), usage, h("div", { class: "small k" }, `created ${b.createdAt}`)),
  );

  const set = (el: HTMLElement, v: number) => {
    const s = String(v);
    if (el.textContent !== s) el.textContent = s;
  };
  return {
    update(fa, fb) {
      set(la.shipped, fa.shipped);
      set(la.queue, fa.queued);
      set(la.damaged, fa.damaged);
      set(lb.shipped, fb.shipped);
      set(lb.queue, fb.queued);
      set(lb.damaged, fb.damaged);
    },
  };
}

export function renderLegend(el: HTMLElement) {
  const sw = (cls: string, text: string) => h("span", { class: "lg" }, h("i", { class: cls }), text);
  el.replaceChildren(
    sw("z-a", "zone A"), sw("z-b", "zone B"), sw("z-c", "zone C"),
    sw("fragile", "fragile"), sw("damaged", "damaged"), sw("missort", "missorted (blink)"),
    sw("andon", "stack light: queue <3 / ≥3 / ≥8"),
  );
}
