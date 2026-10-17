# Brief for Codex: make live-a-11 the hero (site and replay)

From the planning session, 2026-10-17 ~13:55 PT. Deadline 17:00 PT. The push hold has been lifted: you pushed PR #1 at `d337dab`, and the build session pushed `3de9a51`. Push normally to `codex/final-site` per `docs/team/post-rewrite-queue.md`. Never force-push.

## What changed

`live-a-11` continued from `live-a-7`'s champion and memory and **met the full goal on all 15 development days** (6 training + 9 validation; the final split stays locked): 100/100 shipped, 0 mis-sorts, 0 damaged, every day under 25 minutes. Validation objective 18,061 → 3,283 (−81.8%). One accepted change: `pack-B` moved from (0,4) to (3,5), off the dock wall. The designers used the new `measure_legs` ruler (added in `b2fbdee` after runs 8–10 stalled) 9 times.

- Verified: the planning session re-scored `recorded/live-a-11/champion.json` with `scripts/score.ts`: select 3283.44 and train 3345.5, goal check PASS on every day. Simulator code is unchanged since `177fe04`; summary grader hash is `493a1b03…`.
- Published: `recorded/live-a-11/` is in commit `3de9a51`, pushed to `origin/claude/demo-site-and-spec`. It's also in the shared `.git`, so no fetch is needed. Its five run files are byte-identical to `runs/live-a-11/`.

## Tasks, in priority order

1. **Bring in the data only.** In `~/Code/factory-n1-final`: `git checkout 3de9a51 -- recorded/live-a-11 docs/evidence/spend-accounting.json docs/evidence/zero-damage-feasibility.md`. Diff the two evidence files first, and keep yours if you changed them. Do not cherry-pick `3de9a51`; the build session merges README and spec.
2. **Re-score it yourself before claiming it.** `facts.ts` says "Every hero number was recomputed by someone else," so that has to stay true for the new hero. Run `npx tsx scripts/score.ts recorded/live-a-11/champion.json select` (expect 3283.44, DoD PASS) and `… train` (expect 3345.5, PASS), and regenerate the replay from the saved layout and seed the way you did for `live-a-7`. If anything differs, stop and report. Don't switch the hero.
3. **Switch the hero to `live-a-11`.** Every place currently pins `live-a-7`:
   - `web/facts.ts:8` `HERO_RUN`
   - `web/main.ts:124` default run
   - the `default:` value in `scripts/build-static.ts` and `web/vite.config.ts:35`
   - `web/index.html` lines 19 and 30 (the hero and workbench CTAs) and line 43 (agents link)
   - `web/landing.ts:240` (full-replay link)
   Keep `live-a-7` reachable, because it holds the equal-budget proof.
4. **Remove the hard-coded FAIL text.** Read the goal status from the summary (`champion.dodSelect`) instead of hard-coding it:
   - `web/landing.ts:137` ends with "· Zero damage not reached". Change it to something like "−81.8% validation objective · goal met on all 15 development days".
   - `web/landing.ts:110` says the floor "still damages fragile packages, so its goal check fails". For run 11, say run 7 failed on damage and run 11 passes.
   - `web/index.html:93` mentions the "recorded hero" goal limit. Re-check that it's still accurate.
5. **Add a Version N+1 lineage strip on `#proof`.** This feeds video beat 0:30–0:48 and needs to show `Gen 0 18,061` → `run 7 6,083 · goal FAIL (4 damaged on the peak day)` → `run 11 3,283 · goal PASS`, with run 7's FAIL badge visible next to run 11's PASS. Add a disclosure line: "Run 11 continued from run 7's champion and memory, with a route-measuring tool added after runs 8–10 stalled. Development days only; final split locked." Link it to `evidence/zero-damage-feasibility.md`.
6. **Race chart (equal budget).** Keep the four equal-budget bars from `live-a-7`: start 18,061, code fix 13,194, random search 13,099 (41 sim evals), agents 6,083. If you add run 11 (3,283), label it "continued from run 7, not equal budget" (41 + 29 = 70 sim evals). Never put run 11 under "same budget."
7. **`RUNS` in `web/facts.ts`.** Add:
   - `live-a-9`: 6,083.44, "continue from a-7 · no further gain"
   - `live-a-10`: 6,083.44, "no further gain · designers mis-measure legs"
   - `live-a-11`: 3,283.44, "ruler tool · goal met · hero"
   - Optional: the cache stat can cite run 11 (189,312 of 346,054 prompt tokens cached, 54.7%) next to run 8's 49%.
8. **Video speed and labels.** You already shipped `?speed=60` and hidden hero labels in `d337dab`. Make sure both still work with `live-a-11` as the hero.

## Accuracy rules (the judges can check every one)

- Don't say "unseen", "test set" or "final" for run 11. Say "15 development days (final split locked)."
- The equal-budget win over the code fix and random search belongs to run 7 only.
- Don't credit the zone pack stations for mis-sorts 16 → 0. The one-line code fix (pack stations accept all sizes) also gets 0 mis-sorts on all 9 validation days, and `docs/evidence/2026-10-17-live-roundtrip.md` already says mis-sorts come from no pack station accepting size L. The agents' edge is shorter routes: on the peak day, travel drops 6,456 → 2,742 cells, makespan 1,581 → 1,184 s and damage 14 → 0. `landing.ts:145` already says "Zero on all 15 days". Keep it causally neutral.
- Run 11 spent 54 calls and $0.042. Project total: $0.355 inference + $0.10 search; $0.886 counting reservations conservatively (`spend-accounting.json` in `3de9a51`).

## Done means

- `npm test`, typecheck and `npm run build:static` all pass.
- No console errors on `/`, `/replay.html?run=live-a-11` and `/replay.html?run=live-a-7` at 1440×900.
- `live-a-11` replays Gen-0 baseline (left) against `g1-route` (right) and shows 0 damaged at the end.
- The work is committed on `codex/final-site` and pushed to PR #1.
- Send Ben a one-line report with the commit hash, plus the port your dev server runs on so Argon can QA the shots.
