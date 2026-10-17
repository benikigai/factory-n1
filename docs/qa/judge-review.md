# Judge Rubric Review: `127.0.0.1:5180` (Codex Build) & `README.md` (`claude/demo-site-and-spec`)

**Reviewed targets (as of 13:32 PT, 2026-10-17):**
1. **Codex workbench build at `http://127.0.0.1:5180`** (`recursive-factory/src/main.ts` + `/api/runs`)
2. **GitHub `README.md`** (`benikigai/factory-n1`, branch `claude/demo-site-and-spec`, commit `bef0265`)

---

## 1. Rubric Scorecard (Current State vs. Post-Fix Potential)

| Rubric Criterion | Weight | Current Score | With Top 5 Fixes | Judge Rationale (What Works vs. What Costs Points Right Now) |
| :--- | :---: | :---: | :---: | :--- |
| **Technicality** | **40** | **35 / 40** | **39 / 40** | **Strengths:** Frozen deterministic simulator (`SIM 1.1.0`, SHA-256 `493a1b03…`), 6-train / 9-select split, equal-budget 41-run random-search comparator (`13,099`), per-edit counterfactual ablation (`Δ alone`), byte-stable Crusoe prefix caching (up to 49%), and a pre-registered 4-pair negative memory evaluation (`0W/4L`).<br/>**Deductions (−5):** (1) `README.md` line 32 still says *"The goal is hand-written; a goal compiler is in progress"*, leaving the **Done Means Done** track partially hand-authored even though `src/dod/` + `docs/evidence/goal-compiler.md` now exist on `codex/final-site`. (2) In `127.0.0.1:5180` (`Agent factories` view), the `Goal Planner` and `Goal Auditor` nodes show `Not invoked / not yet recorded` (`idle`). |
| **Creativity** | **25** | **21 / 25** | **24 / 25** | **Strengths:** Turning recursive agent evaluation into a physical 100-package 3D fulfillment floor where conveyor leg lengths, queue waits, and size coverage expose model hallucinations (`Lightning`'s fabricated re-run) and misattributed edits (`Super VL`) is a standout concept. The Kenney 3D `Agent factories` drill-down (`Designers → lens → generation → tool receipts`) is memorable.<br/>**Deductions (−4):** On `127.0.0.1:5180`, the "model lied, the grader caught it" story and the `4/7 → 0/7` prediction-refutation finding are buried in text or absent from the initial view, so a judge skimming `127.0.0.1:5180` for 30 seconds misses the most original scientific insight. |
| **Live Demo** | **20** | **13 / 20** | **19 / 20** | **Strengths:** Clean industrial palette, synchronized dual-floor 3D trace rendering on one clock, station inspector, and a bounded `$0.50` / 40-call live-run modal.<br/>**Deductions (−7):** (1) **Wrong default run on `:5180`:** `src/main.ts:106` defaults to `live-a-5` (`−40.6%`, `10,733`) instead of the `README.md` hero run `live-a-7` (`−66.3%`, `6,083`), creating an immediate numbers mismatch! (2) **Frozen 3D canvas on load:** `src/main.ts:15` sets `playing: false`, so the 3D warehouse opens motionless at `00:00` (`shipped 0/100`). (3) **Cold drop:** `:5180` opens directly into the workbench without the landing proof board (`web/index.html`). (4) **No live URL or screenshot in `README.md`.** |
| **Future Potential** | **15** | **11 / 15** | **14 / 15** | **Strengths:** Honest negative transfer result (`0W/4L` on fresh factories F & G) + `experiments.jsonl` trajectory logging (`beforeLayoutHash`, `diff`, `Δ alone`, `measuredSelect`) give a credible foundation for spatial abstraction and LoRA distillation.<br/>**Deductions (−4):** `README.md` line 46 notes *"Memory can make agents worse"* and line 52 notes *"no fine-tuning was run"*, but neither `README.md` nor `:5180` surfaces the concrete **relational lesson-abstraction fix** or shows an example SFT/preference pair from `experiments.jsonl`. |
| **TOTAL** | **100** | **80 / 100** | **96 / 100** | **+16 points recoverable before the 15:45 PT freeze** with zero new model spend. |

---

## 2. The 5 Changes That Raise the Score Most (Ranked by Impact)

### Fix 1 (`+5 pts` — Live Demo & Technical Consistency): Default the workbench to `live-a-7` AND auto-play at `16×` on load
- **Where:** `recursive-factory/src/main.ts` lines 15 & 106 (and verify in `factory-n1-final/web/main.ts` lines 16 & 124).
- **Problem:** Opening `http://127.0.0.1:5180` right now loads `live-a-5` (`18,061 → 10,733`, `−40.6%`) because line 106 hardcodes `entries.find(r=>r.id==='live-a-5')`, while `README.md` and the landing page headline `live-a-7` (`18,061 → 6,083`, `−66.3%`). Worse, `recursive-factory/src/main.ts:15` sets `playing: false`, so the 3D scene sits completely frozen at `00:00` until the judge hunts for the Play button.
- **Exact Change:**
  1. Change the fallback run ID in `src/main.ts:106` from `'live-a-5'` to `'live-a-7'` (already fixed in `factory-n1-final/web/main.ts:124` — make sure the merged site serves `factory-n1-final/web/`).
  2. Ensure `playback.playing` initializes to `!matchMedia('(prefers-reduced-motion: reduce)').matches` so both 3D floors animate immediately at `16×` on page open.

---

### Fix 2 (`+4 pts` — Live Demo & Creativity): Serve the Combined Landing Proof Board (`web/index.html`) as `/` and Link Directly into `/replay.html?run=live-a-7` & `/replay.html?run=live-a-7&view=agents`
- **Where:** Root entry point of the final site (`factory-n1-final/web/index.html` → `./replay.html`).
- **Problem:** `127.0.0.1:5180` cold-drops judges into a 3D viewport + side rail without framing the 3 hackathon tracks, the equal-budget comparator race (`18,061` vs `13,194` heuristic vs `13,099` random search vs `6,083` Nemotron), or the `4/7 → 0/7` prediction refutation.
- **Exact Change:**
  1. Serve `web/index.html` (the combined Landing Proof Board + Argon pipeline/hero layout) at `/` and the Codex+Claude 3D workbench at `/replay.html?run=live-a-7`.
  2. Promote **"The model lied, the grader caught it"** (`Nemotron Lightning` fabricated `≈4` mis-sorts vs. `18` actual in `docs/evidence/2026-10-17-live-roundtrip.md`) into the top hero callout card or the first visible card under the hero so judges see the hook in the first 5 seconds.

---

### Fix 3 (`+3 pts` — Technicality / Done Means Done): Update `README.md` and `#tracks` with the Completed Goal Compiler & Feasibility Bounds (`C2`) + Stage Checkpoints (`C1`)
- **Where:** `README.md` lines 12, 31–32, and `web/index.html` lines 93 & 160 (`#goal-compiler`).
- **Problem:** `README.md` line 32 currently tells judges *"The goal is hand-written; a goal compiler is in progress"*, which invites a deduction on the **Done Means Done** track. Meanwhile, Codex has already completed `src/dod/compiler.ts`, `src/agents/planner.ts` (`Nemotron-3.5-Super-VL`), `src/agents/auditor.ts` (`Nemotron-3-Super-120B-A12B`), physical lower-bound proofs across 672 simulations, tighten-only lattice hashing, and `src/loop/checkpoint.ts` (`15/15` compiler tests + checkpoint resume tests passing in `docs/evidence/goal-compiler.md`).
- **Exact Change:**
  1. In `README.md` (`## The three tracks` → **Done Means Done**), replace *"The goal is hand-written; a goal compiler is in progress"* with the verified compiler architecture: `Super VL` planner + cross-family `Super 120B` auditor + analytical feasibility lower bounds (verified across 672 layouts) + tighten-only SHA-256 lattice, while honestly noting that the single 4-call live round (`$0.0004`) caught two validator edge cases that are fixed in offline regression tests (`docs/evidence/goal-compiler.md`).
  2. In `README.md` (**Version N+1**), mention manifest-hashed generation checkpoint/resume (`src/loop/checkpoint.ts`).

---

### Fix 4 (`+2 pts` — Live Demo & Judge Self-Service): Add the Live Deployment URL + 1-Screen Visual Preview & `replay.html` Deep Links at the Very Top of `README.md`
- **Where:** `README.md` lines 1–8.
- **Problem:** Judges reviewing from GitHub (`benikigai/factory-n1`) currently see a text paragraph and a table, with no clickable link to the hosted demo (`vercel.app`), no screenshot/GIF of the dual-floor 3D replay, and no direct deep links to `/?run=live-a-7`, `/replay.html?run=live-a-7` (3D floor race), and `/replay.html?run=live-a-7&view=agents` (Kenney 3D agent hierarchy).
- **Exact Change:**
  Add a 3-link banner and a static hero screenshot directly under line 5 of `README.md`:
  - **Live Proof Board:** `<deployed-url>/`
  - **3D Dual-Floor Replay (`live-a-7`):** `<deployed-url>/replay.html?run=live-a-7`
  - **3D Agent Hierarchy (`Kenney GLB`):** `<deployed-url>/replay.html?run=live-a-7&view=agents`

---

### Fix 5 (`+2 pts` — Future Potential): Link the Relational Memory-Abstraction Post-Mortem (`docs/research/memory-transfer.md`) and SFT Trajectory Schema in `README.md`
- **Where:** `README.md` lines 13, 33, 46, and 52.
- **Problem:** Reporting the negative memory transfer result (`0W/4L`, median `+2,357` worse on fresh factories F & G) earns high credibility for scientific honesty, but stopping at *"Memory can make agents worse"* without showing the diagnosed mechanism (`7/24` spacing violations from coordinate-anchored lessons vs `2/24` in `NOMEM`) and the relational invariant fix leaves **Future Potential** points on the table.
- **Exact Change:**
  Link `[docs/research/memory-transfer.md](docs/research/memory-transfer.md)` directly from the `Does shared memory help on new factories?` row in `README.md` (line 13) and summarize the two-line takeaway: coordinate-bound lessons (`sort-1 at (12,6)`) caused `3.5×` more spacing violations on shifted dock geometries, motivating a relational abstraction rule (`legCells(u,v) <= 12`, `chebyshev(u,v) >= 2`) and verifiable DPO/SFT pairs from `recorded/live-a-7/experiments.jsonl`.
