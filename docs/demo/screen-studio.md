# Screen Studio 60-Second Demo Production Kit (`Factory N+1`)

**Target runtime:** `0:60` (`60.0s` at 60 fps, `1440×900` HiDPI window capture in Screen Studio)  
**Voiceover mode:** Live mic narration by Ben — record each beat as a separate take and trim them together  
**Hero run artifact:** `live-a-7` (`RECORDED`, frozen simulator `SIM 1.1.0`, grader SHA-256 `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`)  
**Base URL:** `http://127.0.0.1:5190` (or the deployed static Vercel URL; all paths below are relative to the site root)

---

## Verified Numbers & Facts Behind the Script (Captions Only — No 5-Digit Numbers Spoken Aloud)

| Concept / Beat | Spoken Line (Simple & Punchy) | Exact Caption / Verified Fact | Source Artifact |
| :--- | :--- | :--- | :--- |
| **Hook (`0:00–0:07`)** | *"Two minutes, four cents: Nemotron agents redesigned this warehouse floor sixty-six percent better."* | **`live-a-7` wall-clock:** `129 seconds` (~2 min) · **Cost:** `61` Crusoe calls for **`$0.029`** inference + **`~$0.01`** You.com search (≈4¢ total) · **Validation:** **`18,061 → 6,083` (`−66.3%`)** | `recorded/live-a-7/summary.json` |
| **Why `N+1` + Factory Floor (`0:07–0:19`)** | *"Like an inductive step, version N+1 only ships if it beats version N. A simulated parcel floor: receiving, sorting, packing, three shipping docks, a hundred packages a day."* | **Inductive gate:** Candidate layout `N+1` replaces `N` only if it improves held-out selection score by `≥ 1%` (`SIM 1.1.0`, `grader 493a1b03`). | `src/eval/evaluator.js` |
| **Agent Loop & Sponsors (`0:19–0:36`)** | *"Every generation, Nemotron Lightning researches warehouse practice with You.com. Nemotron Super VL designers on Crusoe test drafts and propose layouts."* | **Crusoe Managed Inference:** `Nemotron-3.5-Lightning` (You.com researcher/verifier) + `Nemotron-3.5-Super-VL` (3 parallel designers probing `simulate_layout`) · `38.8%` prompt cache hit (`49%` in `live-a-8`). | `recorded/live-a-7/summary.json` |
| **The Winning Move & Baselines (`0:36–0:47`)** | *"The winner gave each zone its own pack station. Mis-sorts went from sixteen to zero. It beat a code heuristic and random search with the same budget."* | **Winning structural move (`g1-quality`):** Dedicated one pack station per shipping zone (`pack-A → Zone A`, `pack-B → Zone B`, `pack-C → Zone C`, all `S/M/L`) · **Baselines:** Starting floor **`18,061`** · Code heuristic **`13,194`** · 41-run random search **`13,099`** · Champion **`6,083`**. | `recorded/live-a-7/replay.json` |
| **The Model Lied & Honest FAIL (`0:47–0:57`)** | *"When a model invented a fake simulator run, the grader caught it. Four fragile packages still break, so the goal check says fail. We show that too."* | **Fabricated re-run refuted:** Model claimed `≈4` mis-sorts / `1,380s` (PASS); frozen grader measured `18` mis-sorts / `17,900` (REFUTED; `4/7 → 0/7` after `simulate_layout`) · **DoD:** `4` damaged (`FAIL`) · **Shared memory:** Lost `4 of 4` on fresh factories. | `docs/evidence/2026-10-17-live-roundtrip.md` |

---

## Live Voiceover Script (Read Aloud by Ben — 6 Beats)

`[0:00-0:07, both 3D floors at 60x]`  
"Two minutes, four cents: Nemotron agents redesigned this warehouse floor sixty-six percent better. And they never grade their own work."

`[0:07-0:19, zoom into the champion floor with station labels]`  
"This is Factory N+1. Like an inductive step, version N+1 only ships if it beats version N. A simulated parcel floor: receiving, sorting, packing, three shipping docks, a hundred packages a day."

`[0:19-0:36, agent view or loop diagram with sponsor labels]`  
"Every generation, Nemotron Lightning researches warehouse practice with You.com. Nemotron Super VL designers on Crusoe test drafts and propose layouts. A frozen simulator grades them, and a change survives only if it wins on days it never saw."

`[0:36-0:47, equal-budget bar chart]`  
"The winner gave each zone its own pack station. Mis-sorts went from sixteen to zero. It beat a code heuristic and random search with the same budget."

`[0:47-0:57, fabricated re-run evidence tile, then the red FAIL badge]`  
"When a model invented a fake simulator run, the grader caught it. Four fragile packages still break, so the goal check says fail. We show that too."

`[0:57-1:00, pull back to the full landing page]`  
"Factory N+1. The next version earns it."

---

## Retimed 60-Second Shot List, Exact URLs, UI States, Zooms & Captions

| Shot | Time | Duration | Exact URL & UI State | Camera / Cursor Action & Screen Studio Zoom | Lower-Third Caption (Exact Numbers on Screen Only) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Hook: Both 3D Floors at 60×** | `0:00–0:07` | `7s` | `/?run=live-a-7&speed=60` (or `/replay.html?run=live-a-7` toggled to `60×`)<br/>State: Split-screen 3D replay (`Gen-0 baseline` left jammed at `pack-2`, `Agent champion (g1-quality)` right flowing smoothly) at **`60×`** (`sim 02:29 / 26:22 · 60×`). | Start on `/?run=live-a-7&speed=60` (where station labels are hidden for a clean hero view and playback runs at **`60×`**). **Zoom 1.25×** across both 3D floors. | **`18,061 → 6,083 (−66.3%) · 129s RUN · 61 CALLS ($0.029 + $0.01 SEARCH)`**<br/>`Left: Gen-0 Baseline (Jammed) · Right: Agent Champion g1-quality · Grader 493a1b03` |
| **2. Champion Floor & The `N+1` Step** | `0:07–0:19` | `12s` | `/replay.html?run=live-a-7`<br/>State: Right-hand **Agent champion (`g1-quality`)** 3D floor + right rail showing `Gen 0 → Gen 1 → Gen 2` lineage and station labels (`recv-1`, `sort-1/2`, `pack-A/B/C`, `ship-A/B/C`). | Click **Explore the recorded factory** (or switch to `/replay.html?run=live-a-7`) and **Zoom 1.45×** into the right-hand champion 3D floor so the station pills (`recv-1`, `sort-1`, `pack-A SML · A`, `ship-A zone A`) and moving parcels are crisp. | **`VERSION N+1 SHIPS ONLY IF IT BEATS VERSION N`**<br/>`100 packages/day · Receiving → Sorting → Packing → 3 Shipping Docks · Frozen SIM 1.1.0` |
| **3. Agent Hierarchy & Sponsor Loop** | `0:19–0:36` | `17s` | `/replay.html?run=live-a-7&view=agents&node=designers`<br/>State: Click **`Agent workflow`** tab (`0:19`), select **`Designers`** node (`0:22`); shows `You.com` Research (`Nemotron Lightning`), 3 parallel `Nemotron Super VL` designers on `Crusoe`, and the `Evaluator + Gate` node (`11 rejected`). | Click **`Agent workflow`** in the top bar, hover `You.com → Researcher` (`0:20–0:25`), then click **`Designers`** and **Zoom 1.4×** onto the SVG DAG + right-rail inspector (`61 calls · $0.029 · grader 493a1b03`). | **`YOU.COM + CRUSOE NEMOTRON 3.5 → FROZEN SIMULATOR GATE`**<br/>`Lightning researches via You.com · Super VL probes drafts · 61 calls ($0.029) · Grader 493a1b03` |
| **4. Winning Move & Equal-Budget Race** | `0:36–0:47` | `11s` | `/?run=live-a-7&speed=60#proof` (or `/replay.html?run=live-a-7` right-rail **Baseline comparison** + `g1-quality` diff table)<br/>State: `#race` horizontal bar chart + KPI cards (`16 → 0 mis-sorts`, `1,581s → 1,184s`) and `pack-A / pack-B / pack-C` zone-dedicated layout diff. | Switch to Tab 1 at `/?run=live-a-7&speed=60#proof` and **Zoom 1.45×** onto the **`Same task, same simulator budget`** bar chart (`18,061` vs `13,194` vs `13,099` vs `6,083`) and the `16 → 0` mis-sorts card. | **`ONE PACK STATION PER ZONE · MIS-SORTS 16 → 0`**<br/>`Champion: 6,083 · Code Heuristic: 13,194 · 41-Run Random Search: 13,099 · Baseline: 18,061` |
| **5. The Model Lied & Honest FAIL** | `0:47–0:57` | `10s` | `/?run=live-a-7&speed=60#tracks` (and `#proof` `#dod` card)<br/>State: **"The fabricated re-run"** evidence tile (`4/7 → 0/7` refuted predictions) (`0:47–0:52`), then pan/scroll to the red **`FAIL`** badge on `Nothing damaged: 4 FAIL` (`0:52–0:57`). | **Zoom 1.55×** on the fabricated re-run refutation card (`0:47–0:52`), then pan to the red **`FAIL`** badge on `Nothing damaged (4)` and `Shared brain (0/4 on fresh factories)` (`0:52–0:57`). | **`THE MODEL LIED. GRADER 493a1b03 CAUGHT IT.`**<br/>`Fake re-run refuted (claimed 4 mis-sorts vs actual 18) · Goal check: FAIL (4 fragile damaged) · Shared memory: 0/4 on fresh floors` |
| **6. Close: Full Landing Page** | `0:57–1:00` | `3s` | `/?run=live-a-7&speed=60#top`<br/>State: Full landing hero view with `RECORDED · live-a-7`, `grader 493a1b03 · SIM 1.1.0`, and the split 3D preview running at `60×`. | Pull out smoothly to **`1.0×`** full-window frame on `/?run=live-a-7&speed=60#top`. | **`FACTORY N+1 · THE NEXT VERSION EARNS IT`**<br/>`18,061 → 6,083 (−66.3%) · 61 Crusoe Calls ($0.029) · Grader SHA-256 493a1b03` |

---

## Live Recording Tips (Screen Studio + Live Mic)

1. **Record Each Beat as a Separate Take & Trim Together:**
   - Do **not** try to nail all 60 seconds in one continuous take. Record the 6 beats (`0:00–0:07`, `0:07–0:19`, `0:19–0:36`, `0:36–0:47`, `0:47–0:57`, `0:57–1:00`) as separate clips or pause silently for 2 seconds between beats and ripple-delete the gaps in Screen Studio.
2. **Pre-Capture Window & Replay Checklist:**
   - **Window size:** Set browser window to exactly **`1440×900`** (bookmarks bar hidden, macOS Focus / **Notifications OFF**).
   - **Replay speed (`?speed=60`):** Open `http://127.0.0.1:5190/?run=live-a-7&speed=60` for Beat 1 (the `?speed=60` query parameter automatically runs the landing hero at `60×` and hides station labels so the jammed left floor vs. flowing right floor is immediately crystal clear).
   - **Pre-open two tabs** for zero-latency switching:
     - **Tab 1:** `http://127.0.0.1:5190/?run=live-a-7&speed=60` (for Beat 1 `#top`, Beat 4 `#proof`, Beat 5 `#tracks`, and Beat 6 `#top`)
     - **Tab 2:** `http://127.0.0.1:5190/replay.html?run=live-a-7` (for Beat 2 station-labeled 3D floor and Beat 3 `?view=agents&node=designers`).
3. **Spoken Word Count & Cadence:**
   - Total spoken script is **138 words** across 60 seconds (`2.3 words/sec`), with zero five-digit numbers to trip over on mic.
