# Screen Studio 60-Second Demo Production Kit (`Factory N+1` — Run 7 → Run 11 Story)

**Target runtime:** `0:60` (`60.0s` at 60 fps, `1440×900` HiDPI window capture in Screen Studio)  
**Voiceover mode:** Live mic narration by Ben (`138 words`, ~2.3 words/sec) — record each beat as a separate take and trim them together  
**Hero run lineage:** `live-a-7` (`18,061 → 6,083`, `−66.3%`, 4 damaged `FAIL`) $\rightarrow$ `live-a-11` (`6,083 → 3,283`, **`−81.8%` from baseline, 0 damaged, full goal `PASS` on all 15 development days**)  
**Frozen simulator & grader:** `SIM 1.1.0` · grader SHA-256 `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`  
**Base URL:** `http://127.0.0.1:5190` (or the deployed static Vercel URL; all paths below are relative to the site root)

---

## Verified Facts & Guardrails Behind the Script

| Concept / Beat | Verified Fact & Guardrail | Source Artifact |
| :--- | :--- | :--- |
| **Hook (`0:00–0:06`): Full Goal Met in `live-a-11`** | **`live-a-11` validation objective:** **`18,061 → 3,283` (`−81.8%`, `−82%` rounded)** · **Full goal met on all 15 development days** (`6` training + `9` validation; final split locked): `0` mis-sorts, `0` damaged, all under `25` minutes (`1,500s`) · Cost is **`~4¢` per run** (`live-a-7`: `$0.029` Crusoe + `~$0.01` You.com; `live-a-11`: `$0.019` Crusoe). *Guardrail: always say **development days** (`6` training + `9` validation on normal, peak, and fragile days; skewed days are in locked held-out splits)—never call `live-a-11` "unseen", "test", or "final".* | `recorded/live-a-11/summary.json` |
| **Why `N+1` + Factory Floor (`0:06–0:15`)** | **Inductive gate (`src/loop/solve.ts`):** Candidate layout `N+1` replaces `N` only if it improves validation-day score by **`≥ 1%` with no goal-check regression** on the `24×14` floor (`100` packages/day, receiving → sorting → packing → 3 shipping docks, 4 executable goal checks). | `src/loop/solve.ts` |
| **Agent Loop & Sponsors (`0:15–0:30`)** | **Crusoe + NVIDIA Nemotron 3.5 + You.com:** `Nemotron-3.5-Lightning` researches warehouse practice on `You.com` (`2` searches across `3` generations in `live-a-7`; `0` in `live-a-11`, so **use `run=live-a-7&view=agents` for this shot**). `Nemotron-3.5-Super-VL` designers on Crusoe propose layouts; the frozen simulator grades them on validation days the designers never saw (`6` training vs `9` validation days). | `recorded/live-a-7/summary.json` |
| **Run 7 → Run 11 Lineage & Equal-Budget Baselines (`0:30–0:48`)** | **Equal-budget win belongs to `live-a-7` (`41` sim evals):** Starting floor **`18,061`** · 1-line code fix (all stations accept `S/M/L`) **`13,194`** · Equal-budget random search (`41` evals) **`13,099`** · `live-a-7` **`6,083` (`−66.3%`)**. *Guardrail: `16 → 0` mis-sorts comes from accepting size `L` (which the 1-line code fix also achieves); the agents' edge is **shorter routes** (`6,456 → 2,742` cells peak-day travel, `1,581 → 1,184s` makespan, `14 → 0` damage).* **`live-a-11` (`41 + 29 = 70` cumulative evals)** continued from `live-a-7` after adding the `measure_legs` route-measuring tool (after runs 8–10 stalled), shifted `pack-B` `3` cells inland, cut fragile damage from `4 → 0` (`14 → 0` overall), and reached **`3,283` (`−81.8%`)**. | `recorded/live-a-7/summary.json`, `recorded/live-a-11/summary.json` |
| **The Model Lied, Grader Caught It (`0:48–0:55`)** | **Fabricated re-run refuted:** One model claimed a simulator re-run gave **`≈4` mis-sorts, passing**; no re-run happened, and the frozen grader (`493a1b03`) measured **`18` mis-sorts** (`17,900` objective, refuted). | `docs/evidence/2026-10-17-live-roundtrip.md` |

---

## Live Voiceover Script (Read Aloud by Ben — 138 Words, ~2.3 Words/Sec)

`[0:00–0:06 · /?speed=60 landing hero, or /replay.html?run=live-a-11 at 60×]`  
"For a few cents a run, Nemotron agents took this jammed warehouse to its goal. And they never grade their own work."

`[0:06–0:15 · /replay.html?run=live-a-11, zoom 1.45× on the right floor with station labels]`  
"Factory N+1: version N+1 ships only if it beats version N. Receiving, sorting, packing, three shipping docks, a hundred packages."

`[0:15–0:30 · /replay.html?run=live-a-7&view=agents]`  
"Nemotron Lightning researches warehouse practice on You.com. Nemotron Super VL designers on Crusoe propose layouts. A frozen simulator grades them, and a change survives only if it wins on days the designers never saw."

`[0:30–0:48 · /#revisions & /#inspection (or /#proof): equal-budget comparison + Rev 0 → Rev 7 FAIL → Rev 11 APPROVED table]`  
"Run seven put a pack station by each dock: two-thirds better, ahead of a code fix and random search. Fragile packages still broke. Run eleven built on it, moved one station inland, and met the goal."

`[0:48–0:55 · /#inspection (4/7 → 0/7 Claims checked) or /#evidence-section (The fabricated re-run tile)]`  
"One model faked a simulator run. The grader caught it."

`[0:55–1:00 · /#top, pull back to 1.0×]`  
"Factory N+1. The next version earns it."

---

## 60-Second Shot List, Exact URLs, UI States, Zooms & Captions

| Time | Screen (`URL · state`) | Camera / Zoom Action | Ben Says | Lower-Third Caption (On-Screen Text) |
| :--- | :--- | :--- | :--- | :--- |
| **`0:00–0:06`**<br/>*(6s)* | `/?speed=60` landing hero, or `/replay.html?run=live-a-11` at `60×`. Left Gen-0 floor jams, right floor flows (`live-a-11` champion). | **Zoom `1.25×`** across both 3D floors running at `60×` so the left `pack-2` queue pile-up contrasts with the right floor clearing cleanly. | *"For a few cents a run, Nemotron agents took this jammed warehouse to its goal. And they never grade their own work."* | `18,061 → 3,283 (−82%) · goal met on all 15 development days · ~4¢ per run` |
| **`0:06–0:15`**<br/>*(9s)* | `/replay.html?run=live-a-11`, **zoom `1.45×`** on the right floor with station labels (`recv-1`, `sort-1/2`, `pack-A/B/C`, `ship-A/B/C`). | Switch to `/replay.html?run=live-a-11` and **zoom `1.45×`** onto the right-hand champion floor with station pills visible and `pack-B` shifted 3 cells inland. | *"Factory N+1: version N+1 ships only if it beats version N. Receiving, sorting, packing, three shipping docks, a hundred packages."* | `VERSION N+1 SHIPS ONLY IF IT BEATS VERSION N · 24×14 floor · 100 packages · goal = 4 executable checks` |
| **`0:15–0:30`**<br/>*(15s)* | `/replay.html?run=live-a-7&view=agents` *(use `live-a-7` here because `live-a-11` made no You.com searches)*. | Click/open `/replay.html?run=live-a-7&view=agents` (`Designers` / `Researcher` DAG visible) and **zoom `1.4×`** across the `You.com` → `Crusoe Nemotron` → `Evaluator + Gate` pipeline (or show `/#bom` Bill of Materials). | *"Nemotron Lightning researches warehouse practice on You.com. Nemotron Super VL designers on Crusoe propose layouts. A frozen simulator grades them, and a change survives only if it wins on days the designers never saw."* | `YOU.COM → NEMOTRON 3.5 ON CRUSOE → FROZEN GRADER 493a1b03` |
| **`0:30–0:48`**<br/>*(18s)* | `/#revisions` & `/#inspection` *(drafting-sheet layout; `/#proof` on previous layout)*: `Equal budget: 6,083` vs `13,194` & `13,099`, plus `01 Revision history` (`Rev 0 18,061 FAIL → Rev 7 6,083 FAIL → Rev 11 3,283 APPROVED`). | Switch to Tab 1 at `/#revisions` / `/#inspection`, **zoom `1.4×`** on `Equal budget: 6,083` (`0:30–0:39`), then pan to the **`01 Revision history` table (`Rev 7 FAIL → Rev 8–10 HELD → Rev 11 APPROVED`)** (`0:39–0:48`). | *"Run seven put a pack station by each dock: two-thirds better, ahead of a code fix and random search. Fragile packages still broke. Run eleven built on it, moved one station inland, and met the goal."* | `18,061 → 6,083 → 3,283 · damaged 14 → 0 · run 11 continued from run 7 with a route-measuring tool added after run 10 stalled` |
| **`0:48–0:55`**<br/>*(7s)* | `/#inspection` (`Claims checked: 4/7 → 0/7` — *"When a model reported a simulator run that never happened, the grader caught it"*) or `/#evidence-section` (**"The fabricated re-run"** tile). | **Zoom `1.55×`** onto the center **`Claims checked: 4/7 → 0/7`** column in `/#inspection` (or **"The fabricated re-run"** tile in `/#evidence-section`). | *"One model faked a simulator run. The grader caught it."* | `Model claimed a re-run: ≈4 mis-sorts, passing · no re-run happened · grader measured 18` |
| **`0:55–1:00`**<br/>*(5s)* | `/#top`, pull back to **`1.0×`**. | Smoothly zoom out to **`1.0×`** full-window frame on `/#top` (`/?speed=60`). | *"Factory N+1. The next version earns it."* | `FACTORY N+1 · THE NEXT VERSION EARNS IT` |

> **Fallback for `0:30–0:48` (if the `/#proof` lineage strip isn't live yet):** Show the equal-budget race chart on `/#proof` (`0:30–0:39`), then cut from the goal badge in `/replay.html?run=live-a-7` (`FAIL`, `4` damaged) (`0:39–0:43`) to the goal badge in `/replay.html?run=live-a-11` (`PASS`, `0` damaged) (`0:43–0:48`).

---

## Live Recording Tips (Screen Studio + Live Mic)

1. **Record Each Beat as a Separate Take & Trim Together:**
   - Record the 6 beats (`0:00–0:06`, `0:06–0:15`, `0:15–0:30`, `0:30–0:48`, `0:48–0:55`, `0:55–1:00`) as separate takes or pause 2 seconds between beats and ripple-delete the silent gaps in Screen Studio.
2. **Pre-Capture Window & Replay Checklist:**
   - **Window size:** Set browser window to **`1440×900`** (bookmarks bar hidden, macOS Focus / **Notifications OFF**).
   - **Replay speed (`60×`):** Open `/?speed=60` (or toggle `60×` on `/replay.html?run=live-a-11`) before starting Beat 1 so the left Gen-0 floor visibly jams while the right `live-a-11` floor flows cleanly.
   - **Pre-open three tabs** for instant cuts across beats:
     - **Tab 1:** `/?speed=60` (for Beat 1 `#top`, Beat 4 `#proof`, Beat 5 `#tracks`, and Beat 6 `#top`)
     - **Tab 2:** `/replay.html?run=live-a-11` (for Beat 2 right-floor `1.45×` zoom with station labels)
     - **Tab 3:** `/replay.html?run=live-a-7&view=agents` (for Beat 3 `You.com` + `Crusoe` + `Frozen Grader` agent DAG).
