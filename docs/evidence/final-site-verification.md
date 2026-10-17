# Final-site verification

Checked on October 17, 2026 in the isolated `codex/final-site` worktree. The live-a-11 hero was independently re-scored and its replay regenerated before the hero changed.

## Local review

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npx tsc --noEmit -p web/tsconfig.json
npm run build:static
python3 -m http.server 5190 --bind 127.0.0.1 --directory web/dist
```

Open `http://127.0.0.1:5190/`. The build serves committed recordings and public evidence without API credentials or a backend. Browser checks covered the landing page, hero replay, agent hierarchy, Quality's four generations and tool receipts, the four fresh-factory memory comparisons, evidence links, and the separate offline/live compiler results. Desktop and 390-pixel mobile layouts were checked.

For the run-11 update, `/`, `/replay.html?run=live-a-11` and `/replay.html?run=live-a-7` were checked at 1440x900 with no browser-console errors. The run-11 replay ends with Gen 0 on the left and `g1-route` on the right, both shipping 100 packages, with damage 14 versus 0. `/?speed=60` shows the new hero at 60x with all 15 station labels hidden; full replay labels remain visible. The lineage strip shows run 7 FAIL beside run 11 PASS and keeps run 7's four-bar comparison separate.

The final test run passed 65 tests. Both TypeScript checks and the static build passed. The checkpoint test kills and resumes a child process. It verifies identical semantic artifacts, preserved uncertain charges, manifest refusal, and an idempotent completed restart.

## Results the site may claim

- Hero `live-a-11`: validation objective 18,061.11 to 3,283.44, an 81.8% reduction. The full goal passes on all six training and nine validation days, with 100 shipped, zero mis-sorts and zero damage. Its final split remains locked. See `independent-verification-live-a-11.md` and its JSON receipt.
- Earlier `live-a-7`: validation objective 6,083.44 with four damaged packages on the peak replay day. Its 41-search-evaluation equal-budget comparison remains separate from run 11's continuation, which adds 29 search evaluations.
- Shared memory: four losses in four valid paired comparisons on fresh factories, with equal per-arm caps. These are final-split results, separate from development and validation scores.
- Goal compiler: 15 offline tests pass. The single authorized live round made four calls, cost $0.0004162, and rejected both goals. Its two validation issues were corrected offline. The corrected behavior has not been verified in another live round.
- Feasibility bounds passed a separate check against 672 actual simulator runs. Passing a necessary bound does not prove an achievable factory layout.

## Solver integration

Ben explicitly approved applying the combined C1/C2 patch to `src/loop/solve.ts` in the isolated `codex/final-site` branch. The integration is now present in this branch; Claude's working checkout is unchanged. `docs/integration/solve-checkpoint.patch` remains as the reviewed patch record and must not be applied again after merging this branch.

The patch binds the approved goal to checkpoints. Custom approved goals require `research:false` and `probes:0` until helper evaluations accept the same contract. A completed run that records ordinary provider failures stays completed on same-ID restart; deliberately retry it under a new run ID. Interrupted, uncommitted generations can resume while retaining consumed attempts and uncertain charges.
