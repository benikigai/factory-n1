/**
 * Facts shown on the landing page that are not inside a single replay bundle. Every value comes from a
 * recorded artifact (run summaries, evidence docs) and is cited in docs/specs/factory-n1.md.
 * Live values (hero replay, memory test, spend) are fetched from the recorded files at runtime.
 */
export const REPO = "https://github.com/benikigai/factory-n1";

export const HERO_RUN = "live-a-11";
export const MEMORY_EVAL = "memeval-2026-10-17T19-41-04-350Z";

/** Validation objective per live run on factory A (lower is better). Source: runs/<id>/summary.json. */
export const RUNS: { id: string; change: string; select: number | null; note: string }[] = [
  { id: "live-a-1", change: "blind proposals", select: 7011.67, note: "4/7 predictions refuted" },
  { id: "live-a-2", change: "memory + research fixes", select: 9630.78, note: "citation-promotion bug (found later)" },
  { id: "live-a-3", change: "draft-test tool", select: 10344.78, note: "2 consecutive accepts; crashed on a 429" },
  { id: "live-a-4", change: "exploration + stall reflection", select: 12013.56, note: "gate refused 0.6–0.7% gains" },
  { id: "live-a-5", change: "isolated hypothesis tests", select: 10733.22, note: "0/7 refuted · independently verified" },
  { id: "live-a-6", change: "QUALITY lens + inspection fix", select: 9816.78, note: "mislabeled rejected lesson repeated 4×" },
  { id: "live-a-7", change: "rejected-lesson labels", select: 6083.44, note: "equal-budget proof · independently verified" },
  { id: "live-a-8", change: "continue from a-7", select: 6083.44, note: "no further gain · 49% prompt cache hits" },
  { id: "live-a-9", change: "continue from a-7", select: 6083.44, note: "no further gain" },
  { id: "live-a-10", change: "route-fixer lens", select: 6083.44, note: "no further gain · designers mis-measure legs" },
  { id: "live-a-11", change: "ruler tool", select: 3283.44, note: "goal met · hero" },
];
export const GEN0_SELECT = 18061.11;

export const LOG: { t: string; hash: string; text: string; tag?: string }[] = [
  { t: "11:02", hash: "67237fe", text: "Deterministic simulator, executable goal checks, Crusoe client" },
  { t: "11:10", hash: "4bac5aa", text: "First live Nemotron tool call into the simulator. Lightning invents a simulator re-run; the grader refutes it", tag: "insight" },
  { t: "11:32", hash: "e88bd4b", text: "Grader bug found by audit: 98/100 traces scrambled. Fixed, regression-tested, frozen (SIM 1.1.0)", tag: "fix" },
  { t: "11:38", hash: "18877e4", text: "Codex provider slice: spend reservations, typed tool turns, live You.com with exact-URL citations" },
  { t: "12:02", hash: "72e76d6", text: "Full loop: research → shared memory → Nemotron designers → frozen grader → 3D replay" },
  { t: "12:20", hash: "22c8090", text: "Argon's You.com upgrade (boost_domains, highlights, receipts), verified by a before/after check" },
  { t: "12:27", hash: "2e33923", text: "Damage-attribution and rejected-lesson fixes; memory experiment locked before any arm ran", tag: "fix" },
  { t: "12:37", hash: "fc328ae", text: "First memory evaluation INVALID (infrastructure). Labeled, kept, reconciled", tag: "honest" },
  { t: "12:47", hash: "3336bbc", text: "Valid memory evaluation: shared memory lost 4 of 4 pairs on fresh factories", tag: "honest" },
  { t: "13:15", hash: "0a3d731", text: "As-built spec, continue-from-run (N+1 across runs), route-fixer lens" },
];

export const INSIGHTS = [
  { k: "The model lied; the grader caught it.", v: "In our first live call, Nemotron Lightning described a simulator re-run that never happened. Nothing it says is scored; only the frozen simulator scores." },
  { k: "Measure the edit, not the story.", v: "Super VL credited a fix to the wrong change. Code now scores every edit on its own, and lessons may cite only those receipts." },
  { k: "Testing your own drafts makes you honest.", v: "Blind designers had 4 of 7 score predictions refuted. With a bounded simulate tool, 0 of 7." },
  { k: "Memory can make agents worse.", v: "Lessons from one factory carried its coordinates and hurt on fresh factories: 0 wins, 4 losses, 7/24 invalid proposals vs 2/24." },
  { k: "Every hero number was recomputed by someone else.", v: "Codex independently re-scored candidates and regenerated the replays from saved layouts and seeds." },
];
