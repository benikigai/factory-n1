# Screen Studio 60-Second Demo Production Kit (`Factory N+1` — Run 7 → Run 11 Story + Live Laptop Cut)

**Target runtime:** `0:60` (`60.0s` at 60 fps, `1440×900` HiDPI window capture in Screen Studio)  
**Voiceover mode:** Live mic narration by Ben (`135 words`, ~2.25 words/sec) — record each beat as a separate take and trim them together  
**Hero run lineage:** `live-a-7` (`18,061 → 6,083`, `−66.3%`, 4 damaged `FAIL`) $\rightarrow$ `live-a-11` (`6,083 → 3,283`, **`−81.8%` from baseline, 0 damaged, full goal `PASS` on all 15 development days**)  
**Live laptop cut (`0:25–0:30`):** Real-time run started via **`Run live on Crusoe` > `Continue from run 7`** on `http://localhost:5173` (`FACTORY_ENV_FILE=... npm run web` in `~/Code/factory-n1`), showing the **`LIVE` badge** (`#mode-badge`) and the 3D floor updating as generations land (~2 min total runtime, `~$0.05` on Ben's key)  
**Frozen simulator & grader:** `SIM 1.1.0` · grader SHA-256 `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`  
**Base URL:** `http://localhost:5173` (after the quick-fixes dev-server restart with `FACTORY_ENV_FILE=... npm run web`; recorded `run 11` / `run 7` shots also work identically on `http://127.0.0.1:5180` or `http://127.0.0.1:5190`)

---

## Verified Facts & Guardrails Behind the Script

| Concept / Beat | Verified Fact & Guardrail | Source Artifact |
| :--- | :--- | :--- |
| **Hook (`0:00–0:06`): Full Goal Met in `live-a-11`** | **`live-a-11` validation objective:** **`18,061 → 3,283` (`−81.8%`, `−82%` rounded)** · **Full goal met on all 15 development days** (`6` training + `9` validation; final split locked): `0` mis-sorts, `0` damaged, all under `25` minutes (`1,500s`) · Cost is **`~4¢` per run** (`live-a-7`: `$0.029` Crusoe + `~$0.01` You.com; `live-a-11`: `$0.019` Crusoe). *Guardrail: always say **development days** (`6` training + `9` validation on normal, peak, and fragile days; skewed days are in locked held-out splits)—never call `live-a-11` "unseen", "test", or "final".* | `recorded/live-a-11/summary.json` |
| **Why `N+1` + Factory Floor (`0:06–0:15`)** | **Inductive gate (`src/loop/solve.ts`):** Candidate layout `N+1` replaces `N` only if it improves validation-day score by **`≥ 1%` with no goal-check regression** on the `24×14` floor (`100` packages/day, receiving → sorting → packing → 3 shipping docks, 4 executable goal checks). | `src/loop/solve.ts` |
| **Agent Loop (`0:15–0:25`) + Real Laptop `LIVE` Run (`0:25–0:30`)** | **1. Recorded Agent DAG (`0:15–0:25`):** `Nemotron-3.5-Lightning` researches warehouse practice on `You.com` (`2` searches across `3` generations in `live-a-7`; `0` in `live-a-11`, so **use `run=live-a-7&view=agents` for `0:15–0:25`**). `Nemotron-3.5-Super-VL` designers propose layouts; the frozen simulator grades them on validation days the designers never saw.<br/>**2. Real Laptop `LIVE` Cut (`0:25–0:30`):** After the quick-fixes dev server restarts (`FACTORY_ENV_FILE=... npm run web` in `~/Code/factory-n1` $\rightarrow$ `http://localhost:5173`), **Ben clicks `Run live on Crusoe` > `Continue from run 7` before starting the `0:15–0:30` take** (~2 min run, `~$0.05`). The viewer opens `/replay.html?run=<live-run-id>` with the **`LIVE` badge** (`#mode-badge`) and auto-refreshes every 2s as generations land and the floor updates. *(Only Ben starts paid runs.)* | `recorded/live-a-7/summary.json`, `web/run-live.ts`, `web/live-runner.ts` |
| **Run 7 → Run 11 Lineage & Equal-Budget Baselines (`0:30–0:48`)** | **Equal-budget win belongs to `live-a-7` (`41` sim evals):** Starting floor **`18,061`** · 1-line code fix (all stations accept `S/M/L`) **`13,194`** · Equal-budget random search (`41` evals) **`13,099`** · `live-a-7` **`6,083` (`−66.3%`)**. *Guardrail: `16 → 0` mis-sorts comes from accepting size `L` (which the 1-line code fix also achieves); the agents' edge is **shorter routes** (`6,456 → 2,742` cells peak-day travel, `1,581 → 1,184s` makespan, `14 → 0` damage).* **`live-a-11` (`41 + 29 = 70` cumulative evals)** continued from `live-a-7` after adding the `measure_legs` route-measuring tool (after runs 8–10 stalled), shifted `pack-B` `3` cells inland, cut fragile damage from `4 → 0` (`14 → 0` overall), and reached **`3,283` (`−81.8%`)**. | `recorded/live-a-7/summary.json`, `recorded/live-a-11/summary.json` |
| **The Model Lied, Grader Caught It (`0:48–0:55`)** | **Fabricated re-run refuted:** One model claimed a simulator re-run gave **`≈4` mis-sorts, passing**; no re-run happened, and the frozen grader (`493a1b03`) measured **`18` mis-sorts** (`17,900` objective, refuted). | `docs/evidence/2026-10-17-live-roundtrip.md` |

---

## Live Voiceover Script (Ben's Voice — 127 Words, Plainspoken, Zero Em Dashes)

`[0:00–0:06 · /?speed=60 landing hero, or /replay.html?run=live-a-11 at 60×]`  
"Left floor is jammed. Right floor clears every box. Four cents of Nemotron."

`[0:06–0:15 · /replay.html?run=live-a-11, zoom 1.45× on the right floor with station labels]`  
"We call it Factory N plus one. A new layout only ships if it beats the old one. Simple rule."

`[0:15–0:25 · /replay.html?run=live-a-7&view=agents (+ 0:21–0:25 view=visual)]`  
"Lightning looks up warehouse rules on You.com. Super VL sketches layouts on Crusoe. A locked simulator grades every day."

`[0:25–0:30 · localhost:5173/replay.html?run=live-demo-2 (or live laptop run with LIVE badge)]`  
"Here is a live run from my laptop today. Sixty six seconds."  
*(If rolling a brand-new live run mid-take: "This is running live on my laptop right now.")*

`[0:30–0:48 · /#inspection & /#revisions: equal-budget comparison + Rev 0 → Rev 7 FAIL → Rev 8–10 HELD → Rev 11 APPROVED]`  
"Run seven beat a code fix and random search on the same budget. Still broke four fragile boxes, and three runs stalled counting steps wrong. We gave it a ruler. Run eleven moved one pack table in, zero broken."

`[0:48–0:55 · /#inspection (4/7 → 0/7 Claims checked — fabricated re-run)]`  
"One model even faked a simulator score. The grader caught it cold."

`[0:55–1:00 · /#top, pull back to 1.0×]`  
"Factory N plus one. The next version earns it."

---

## 60-Second Shot List, Exact URLs, UI States, Zooms & Captions

| Time | Screen (`URL · state`) | Camera / Zoom Action | Ben Says | Lower-Third Caption (On-Screen Text) |
| :--- | :--- | :--- | :--- | :--- |
| **`0:00–0:06`**<br/>*(6s)* | `/?speed=60` landing hero, or `/replay.html?run=live-a-11` at `60×`. Left Gen-0 floor jams, right floor flows (`live-a-11` champion). | **Zoom `1.25×`** across both 3D floors running at `60×` so the left `pack-2` queue pile-up contrasts with the right floor clearing cleanly. | *"For a few cents a run, Nemotron agents took this jammed warehouse to its goal. And they never grade their own work."* | `18,061 → 3,283 (−82%) · goal met on all 15 development days · ~4¢ per run` |
| **`0:06–0:15`**<br/>*(9s)* | `/replay.html?run=live-a-11`, **zoom `1.45×`** on the right floor with station labels (`recv-1`, `sort-1/2`, `pack-A/B/C`, `ship-A/B/C`). | Switch to `/replay.html?run=live-a-11` and **zoom `1.45×`** onto the right-hand champion floor with station pills visible and `pack-B` shifted 3 cells inland. | *"Factory N+1: version N+1 ships only if it beats version N. Receiving, sorting, packing, three shipping docks, a hundred packages."* | `VERSION N+1 SHIPS ONLY IF IT BEATS VERSION N · 24×14 floor · 100 packages · goal = 4 executable checks` |
| **`0:15–0:25`**<br/>*(10s)* | `/replay.html?run=live-a-7&view=agents` *(use `live-a-7` here because `live-a-11` made no You.com searches)*. | Open `/replay.html?run=live-a-7&view=agents` (`Designers` / `Researcher` DAG visible) and **zoom `1.4×`** across the `You.com` → `Crusoe Nemotron` → `Evaluator + Gate` pipeline. | *"Nemotron Lightning researches warehouse practice on You.com. Nemotron Super VL designers propose layouts. A frozen simulator grades them, and a change survives only if it wins on days they never saw."* | `YOU.COM → NEMOTRON 3.5 ON CRUSOE → FROZEN GRADER 493a1b03` |
| **`0:25–0:30`**<br/>*(5s)* | `http://localhost:5173/replay.html?run=<live-run-id>` *(started before the take via **`Run live on Crusoe` > `Continue from run 7`** after the quick-fixes restart)*. **`LIVE` badge** (`#mode-badge`) visible in top-left HUD while generations land and the floor updates. | Switch to the active live-run tab (`http://localhost:5173/replay.html?run=<live-run-id>`); **zoom `1.3×`** framing the top-left **`LIVE` badge** (`#mode-badge`), the updating 3D floor, and the right-rail experiment table as a new generation lands. | *"This is running live, Nemotron on Crusoe, right now."* | `LIVE run on Ben's laptop: real Nemotron calls on Crusoe` |
| **`0:30–0:48`**<br/>*(18s)* | `/#revisions` & `/#inspection`: `Equal budget: 6,083` vs `13,194` & `13,099`, plus `01 Revision history` (`Rev 0 18,061 FAIL → Rev 7 6,083 FAIL → Rev 11 3,283 APPROVED`). | Switch to Tab 1 at `/#revisions` / `/#inspection`, **zoom `1.4×`** on `Equal budget: 6,083` (`0:30–0:39`), then pan to the **`01 Revision history` table (`Rev 7 FAIL → Rev 8–10 HELD → Rev 11 APPROVED`)** (`0:39–0:48`). | *"Run seven put a pack station by each dock: two-thirds better, ahead of a code fix and random search. Fragile packages still broke. Run eleven built on it, moved one station inland, and met the goal."* | `18,061 → 6,083 → 3,283 · damaged 14 → 0 · run 11 continued from run 7 with a route-measuring tool added after run 10 stalled` |
| **`0:48–0:55`**<br/>*(7s)* | `/#inspection` (`Claims checked: 4/7 → 0/7` — *"When a model reported a simulator run that never happened, the grader caught it"*). | **Zoom `1.55×`** onto the center **`Claims checked: 4/7 → 0/7`** column in `/#inspection`. | *"One model faked a simulator run. The grader caught it."* | `Model claimed a re-run: ≈4 mis-sorts, passing · no re-run happened · grader measured 18` |
| **`0:55–1:00`**<br/>*(5s)* | `/#top`, pull back to **`1.0×`**. | Smoothly zoom out to **`1.0×`** full-window frame on `/#top` (`/?speed=60`). | *"Factory N+1. The next version earns it."* | `FACTORY N+1 · THE NEXT VERSION EARNS IT` |

---

## Live Recording & Pre-Take Staging Checklist (Screen Studio + Live Mic)

1. **Staging the `0:25–0:30` Real Laptop `LIVE` Cut (Before Recording Beat 3):**
   - Wait for the quick-fixes session to restart the local dev server with your key:
     ```bash
     FACTORY_ENV_FILE=... npm run web   # in ~/Code/factory-n1 → serves http://localhost:5173
     ```
   - Open `http://localhost:5173` (or `http://localhost:5173/replay.html?run=live-a-7`). In the **`Run live on Crusoe`** bar (`.run-live`), click **`Continue from run 7`** **Right Before** you start recording the `0:15–0:30` take (a live run takes `~2 minutes` and costs `~$0.05`).
   - Clicking **`Continue from run 7`** automatically opens `http://localhost:5173/replay.html?run=<live-run-id>` with **`LIVE`** in `#mode-badge` and auto-refreshes every `2s` as generations land and the 3D floor updates.
   - Start the `0:15–0:30` take on Tab 3 (`/replay.html?run=live-a-7&view=agents` for `0:15–0:25`), then switch to Tab 4 (the running `http://localhost:5173/replay.html?run=<live-run-id>` tab with the **`LIVE`** badge) at `0:25` and say: *"This is running live, Nemotron on Crusoe, right now."* (Or record `0:25–0:30` as its own 5-second pickup take while the live run is mid-generation.)
2. **Pre-Capture Window & Tab Layout (`1440×900`, Notifications OFF):**
   - **Tab 1:** `http://localhost:5173/?speed=60` (for Beat 1 `#top` at `60×`, Beat 4 `#revisions` / `#inspection`, Beat 5 `#inspection`, and Beat 6 `#top`)
   - **Tab 2:** `http://localhost:5173/replay.html?run=live-a-11` (for Beat 2 right-floor `1.45×` zoom with station labels; click `60×` before rolling)
   - **Tab 3:** `http://localhost:5173/replay.html?run=live-a-7&view=agents` (for Beat 3a `0:15–0:25` `You.com` + `Crusoe` + `Frozen Grader` agent DAG)
   - **Tab 4:** `http://localhost:5173/replay.html?run=<live-run-id>` (started via **`Run live on Crusoe` > `Continue from run 7`**, showing the **`LIVE`** badge + floor updating for Beat 3b `0:25–0:30`).
