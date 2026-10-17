# Screen Studio 60-Second Demo Production Kit (`Factory N+1`)

**Target runtime:** `0:60` (`60.0s` at 60 fps, `1440×900` HiDPI window capture in Screen Studio)  
**Voiceover target:** Live mic narration by Ben while recording in Screen Studio (`142 words` total across 6 shots — short sentences with breathing room for live clicks)  
**Hero run artifact:** `live-a-7` (`RECORDED`, frozen simulator `SIM 1.1.0`, grader SHA-256 `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`)  
**Base URL:** `http://localhost:5173` (or the deployed static Vercel URL; all paths below are relative to the site root)

---

## Verified Numbers Checklist (Strict Guardrails)

| Metric / Claim | Verified Value | Source Artifact |
| :--- | :--- | :--- |
| **Opening refutation ("The model lied")** | `Nemotron-3.5-Lightning` claimed a "quick re-run" gave **≈4 mis-sorts** and **≈1,380s makespan (passing)**. Frozen grader measured **18 / 15 / 14 mis-sorts**, **1,649s makespan**, and **17,900 objective** (refuted). | `docs/evidence/2026-10-17-live-roundtrip.md` |
| **Prediction honesty after `simulate_layout` probe** | Refuted score predictions dropped from **4 of 7** (blind designers) to **0 of 7** (probing designers). | `README.md` / `web/index.html#tracks` |
| **Validation objective (`live-a-7`, 9 selection days)** | **18,061 → 6,083 (−66.3%)** (exact: `18,061.11 → 6,083.44`, `−66.32%`) | `recorded/live-a-7/summary.json` |
| **One-line code heuristic (pack accepts S, M, L)** | **13,194** (exact: `13,194.44` on selection split) | `recorded/live-a-7/summary.json` |
| **Equal-budget random search (same 41 sim runs)** | **13,099** (exact: `13,098.67` on selection split) | `recorded/live-a-7/summary.json` |
| **Peak-day replay (`peak-202`, 100 packages)** | Shipped **100/100**, mis-sorts **16 → 0**, makespan **1,581s → 1,184s**, damaged **14 → 4** | `recorded/live-a-7/replay.json` |
| **Definition of Done status** | **FAIL / NOT MET** — zero damage was **NOT reached** (`4` damaged on replay day; `4–12` per training day on one 15-cell route). | `recorded/live-a-7/replay.json` |
| **Shared memory transfer on fresh factories (F & G)** | **Lost 4 of 4** paired tests (`0W / 0T / 4L`, median **+2,357** worse; **7/24** invalid proposals with memory vs **2/24** without). | `docs/evidence/memory-eval-valid.md` |
| **Crusoe inference & cache (`live-a-7` / `live-a-8`)** | `live-a-7`: **61 calls, $0.029**, **38.8%** prompt cache hit (`85,952 / 221,502` tokens); up to **49%** in `live-a-8`. | `recorded/live-a-7/summary.json` |

---

## Pre-Capture Setup (Before Hitting Record)

1. Start the combined site and open Chrome/Arc in a clean window sized to **`1440×900`** (hide bookmarks bar, notifications off, cursor size `1.25×` in Screen Studio).
2. Pre-open two tabs so transitions are instant:
   - **Tab 1 (Landing Proof Board):** `/?run=live-a-7#tracks` (scrolled to `#tracks` for the opening refutation card, ready to scroll up to `#top` and `#proof`).
   - **Tab 2 (3D Recorded Workbench):** `/replay.html?run=live-a-7` (paused at `sim 00:00`, speed `16×`, camera preset `Overview`).
3. Confirm the top status pill reads **`RECORDED · live-a-7`** and **`grader 493a1b03 · SIM 1.1.0`**.

---

## 60-Second Shot List, UI States, Captions & Screen Studio Zooms

| Shot | Time | Duration | Exact URL & UI State | Camera / Cursor Action & Screen Studio Zoom | Lower-Third Caption (On-Screen Text) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Hook: The Model Lied** | `0:00–0:10` | `10s` | `/?run=live-a-7#tracks`<br/>State: **Done Means Done** card in `#tracks` showing `4/7 predictions refuted when designers worked blind → 0/7 after simulate_layout` + click/hover `./evidence/2026-10-17-live-roundtrip.md` card in `#evidence-section`. | **Zoom 1.6×** on the `Done means done` card (`4/7 → 0/7`) for `0:00–0:05`, then pan to the **"The fabricated re-run"** evidence tile (`0:05–0:10`). | **`THE MODEL LIED. THE GRADER CAUGHT IT.`**<br/>`Nemotron Lightning claimed 4 mis-sorts (PASS) · Frozen Sim 1.1.0 measured 18 mis-sorts (17,900) → REFUTED` |
| **2. Dual-Floor 3D Race** | `0:10–0:22` | `12s` | `/?run=live-a-7#top` → click **Explore the recorded factory** (`/replay.html?run=live-a-7`)<br/>State: Split-screen 3D replay (`Starting floor` left, `Agents' floor` right), badge `RECORDED · live-a-7`, speed `16×`, clock scrubbing `00:00 → 19:44`. | Start on the hero split stage (`#hero-scene`), then click into `/replay.html?run=live-a-7`. **Zoom 1.35×** on the left floor's `pack-2` queue pile-up vs. the right floor clearing smoothly. | **`SAME 100 PACKAGES · ONE SHARED CLOCK · SIM 1.1.0`**<br/>`Left: Gen-0 Baseline (1,581s, 16 mis-sorts) · Right: Agent Champion g1-quality (1,184s, 0 mis-sorts)` |
| **3. Agent Hierarchy & Loop** | `0:22–0:34` | `12s` | `/replay.html?run=live-a-7&view=agents` → click **Designers** (`/replay.html?run=live-a-7&view=agents&node=designers`)<br/>State: `Agent factories` button active; Kenney 3D agent floor visible; right rail open to `Agent inspector` + `Accepted changes` (`g1-quality`) and `Rejected proposals (11)`. | Click **`Agent factories`** in the right rail (`0:22`), click the **Designers** 3D station (`0:25`), then **Zoom 1.45×** on the right rail showing `g1-quality` per-edit causal receipts (`Δ alone`) and the 11 rejected proposals. | **`CRUSOE + NEMOTRON 3.5 + YOU.COM → CODE GATE`**<br/>`You.com hypotheses tested in isolation · Super VL proposes via typed tools · ≥1% validation gate + per-edit Δ alone` |
| **4. Equal-Budget Race** | `0:34–0:46` | `12s` | `/?run=live-a-7#proof`<br/>State: Scroll to `#proof` showing the 4 KPI cards (`−66.3%`, `16 → 0 mis-sorts`, `1,581→1,184s`, `4 dmg Goal: FAIL`) and the `#race` horizontal bar chart. | **Zoom 1.4×** onto the **`Same task, same simulator budget`** bar chart comparing `Starting floor (18,061)`, `One-line code heuristic (13,194)`, `Blind random search, 41 sim runs (13,099)`, and `Nemotron agents live-a-7 (6,083)`. | **`VALIDATION OBJECTIVE: 18,061 → 6,083 (−66.3%)`**<br/>`Beats 1-line code heuristic (13,194) and equal-budget 41-eval random search (13,099) · 61 Crusoe calls ($0.029)` |
| **5. Honest Failures (DoD & Memory)** | `0:46–0:55` | `9s` | `/?run=live-a-7#proof` (left card `#dod`) → scroll to `/?run=live-a-7#tracks` (**Shared brain** card `#memory-chart`)<br/>State: `#dod` table showing `Nothing damaged: 4 FAIL` (`0:46–0:50`), then `#memory-chart` showing `0 wins · 0 ties · 4 losses` (`+2,357` median worse on Factories F & G). | **Zoom 1.5×** on the red `FAIL` badge on `Nothing damaged` (`0:46–0:50`), then smooth scroll down to the `Shared brain` dumbbell chart (`0:50–0:55`). | **`HONESTY IS THE FEATURE: ZERO DAMAGE NOT REACHED`**<br/>`Goal check stays FAIL (4 damaged) · Shared memory lost 4 of 4 on fresh factories (+2,357 median worse)` |
| **6. Close: Auditable Receipts** | `0:55–1:00` | `5s` | `/?run=live-a-7#top`<br/>State: Full landing hero view with `RECORDED · live-a-7`, `grader 493a1b03 · SIM 1.1.0`, and both 3D floors running in sync. | Pull out to full `1.0×` frame on `#top` as the replay clock loops cleanly. | **`FACTORY N+1 · EVERY CLAIM MEASURED BY CODE`**<br/>`Crusoe Managed Inference × NVIDIA Nemotron 3.5 × You.com · Grader SHA-256 493a1b03` |

---

## Live Voiceover Script (Read Aloud by Ben — 142 Words Total)

`[0:00 #tracks — Done Means Done card]`  
The model lied, and the grader caught it. Nemotron Lightning invented a simulator re-run and claimed four mis-sorts. Our frozen grader measured eighteen, and refuted it.

`[0:10 /replay.html?run=live-a-7 — 3D replay view]`  
This is Factory N-plus-one. Our agent team redesigns a hundred-package factory floor. Left is the starting layout. Right is our champion, running on one shared clock.

`[0:22 ?view=agents&node=designers — Agent workflow view]`  
On Crusoe, Lightning searches You-dot-com for warehouse priors. Nemotron Super designers test drafts in the simulator. Our code gate checks every edit and rejects eleven bad proposals.

`[0:34 /#proof — baseline race chart]`  
In run live-A-seven, validation drops from eighteen-thousand-sixty-one to six-thousand-eighty-three. That is minus sixty-six point three percent. It beats the code heuristic at thirteen-thousand-one-ninety-four, and forty-one-run random search at thirteen-thousand-ninety-nine.

`[0:46 /#tracks — goal check & shared memory]`  
We also show what failed. Zero damage was not reached. And on fresh factories, shared memory lost four of four.

`[0:55 /#top — hero overview]`  
Self-improving agents only work when the grader cannot be gamed. Every run is replayable.

---

## Live Recording & Pacing Notes

1. **Pacing (`142 words` total):** `26 + 26 + 27 + 29 + 20 + 14 = 142 spoken words` (`~2.35 words/sec`). Each cue leaves a natural half-second pause to click or switch tabs before speaking the next line.
2. **Tab-Switch Shortcut:** Keep Tab 1 (`/?run=live-a-7#tracks`) and Tab 2 (`/replay.html?run=live-a-7`) side-by-side and use `Cmd+Option+Right` / `Cmd+Option+Left` (or `Cmd+1` / `Cmd+2`) at `[0:10]` and `[0:34]` so your cursor stays inside the canvas while you speak.
