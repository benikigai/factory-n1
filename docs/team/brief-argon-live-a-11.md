# Brief for Argon: retime the 60-second video to the run 7 → run 11 story

From the planning session, 2026-10-17 ~13:55 PT. Deadline 17:00 PT. The push hold has been lifted. Push `argon/demo-kit` normally. Never force-push.

## ⚠️ Keep the stash out of commits

Before your re-sync, the working tree had 95 tracked files deleted and 6 modified, including `src/sim/version.ts` from the frozen simulator. You stashed them as `stash@{0}` ("stash working tree before rebase onto 31de439"). Keep that stash out of every commit, and don't pop it onto `argon/demo-kit`. Commit only `docs/demo/screen-studio.md` and your QA files. Tell Ben what the stash is so he can decide what to do with it.

## What changed

`live-a-11` continued from `live-a-7`'s champion and memory and **met the full goal on all 15 development days** (final split locked): 0 mis-sorts, 0 damaged, all under 25 minutes. Validation objective 18,061 → 3,283 (−81.8%). One move: pack-B shifted 3 cells inland. The designers used a route-measuring tool (`measure_legs`) that was added after runs 8–10 stalled. The planning session re-scored it with the frozen grader. Codex is switching the site hero to `live-a-11` and adding a run 7 FAIL → run 11 PASS lineage strip on `#proof` (brief: `docs/team/brief-codex-live-a-11.md`).

## Task: update `docs/demo/screen-studio.md`

Replace the voiceover and shot list with the script below. Ben speaks it live. It's 138 words, about 2.3 per second. Keep your recording tips, window size and two-tab setup.

| Time | Screen (URL · state) | Ben says | Caption |
|---|---|---|---|
| 0:00–0:06 | `/?speed=60` landing hero, or `/replay.html?run=live-a-11` at 60×. Left Gen-0 floor jams, right floor flows | "For a few cents a run, Nemotron agents took this jammed warehouse to its goal. And they never grade their own work." | `18,061 → 3,283 (−82%) · goal met on all 15 development days · ~4¢ per run` |
| 0:06–0:15 | `/replay.html?run=live-a-11`, zoom 1.45× on the right floor with station labels | "Factory N+1: version N+1 ships only if it beats version N. Receiving, sorting, packing, three shipping docks, a hundred packages." | `VERSION N+1 SHIPS ONLY IF IT BEATS VERSION N · 24×14 floor · 100 packages · goal = 4 executable checks` |
| 0:15–0:30 | `/replay.html?run=live-a-7&view=agents`. Use run 7 here, because run 11 made no You.com searches | "Nemotron Lightning researches warehouse practice on You.com. Nemotron Super VL designers on Crusoe propose layouts. A frozen simulator grades them, and a change survives only if it wins on days the designers never saw." | `YOU.COM → NEMOTRON 3.5 ON CRUSOE → FROZEN GRADER 493a1b03` |
| 0:30–0:48 | `/#proof`: equal-budget race chart, then the lineage strip (run 7 FAIL → run 11 PASS) | "Run seven put a pack station by each dock: two-thirds better, ahead of a code fix and random search. Fragile packages still broke. Run eleven built on it, moved one station inland, and met the goal." | `18,061 → 6,083 → 3,283 · damaged 14 → 0 · run 11 continued from run 7 with a route-measuring tool added after run 10 stalled` |
| 0:48–0:55 | `/#tracks`, fabricated re-run evidence tile | "One model faked a simulator run. The grader caught it." | `Model claimed a re-run: ≈4 mis-sorts, passing · no re-run happened · grader measured 18` |
| 0:55–1:00 | `/#top`, pull back to 1.0× | "Factory N+1. The next version earns it." | `FACTORY N+1 · THE NEXT VERSION EARNS IT` |

**Fallback for 0:30–0:48** if Codex's lineage strip isn't live: show the race chart, then cut from the goal badge in `/replay.html?run=live-a-7` (FAIL, 4 damaged) to the one in `/replay.html?run=live-a-11` (PASS, 0 damaged).

## Corrections to your verified-facts table

- **Mis-sorts 16 → 0 is not caused by the zone pack stations.** The one-line code fix (stations accept all sizes) also gets 0 mis-sorts on all 9 validation days, and `docs/evidence/2026-10-17-live-roundtrip.md` already says mis-sorts come from no pack station accepting size L. Don't caption "ONE PACK STATION PER ZONE · MIS-SORTS 16 → 0." The agents' edge is shorter routes: peak-day travel 6,456 → 2,742 cells, makespan 1,581 → 1,184 s, damage 14 → 0.
- **The equal-budget win** over the code fix (13,194) and random search (13,099, 41 sim evals) **belongs to run 7.** Run 11 used 41 + 29 = 70 evals cumulatively.
- **Drop "every generation"** for You.com research. Run 7 ran 2 searches in 3 generations, and run 11 ran 0.
- **Days:** the agents were trained and gated on normal, peak and fragile days. Skewed days only appear in the held-out splits.
- **Run 11 is on development days** (6 training + 9 validation). Never call it "unseen", "test" or "final."
- **Source path:** the N+1 gate row cites `src/eval/evaluator.js`, which doesn't exist. The gate is in `src/loop/solve.ts` (accept only if ≥1% better on validation days with no goal-check regression).
- **Remove the FAIL ending** ("Four fragile packages still break… we show that too"). It's no longer the latest result. Keep the honesty beat as the fabricated-run catch.

## QA, after Codex reports its commit and dev-server port

At 1440×900, open each URL in the table and confirm the stated state renders: 60× speed, station labels, the `view=agents` DAG, the race chart, the lineage strip, the fabricated-run tile and `#top`. List anything missing or wrong in one message to Ben, with the time slot it affects.
