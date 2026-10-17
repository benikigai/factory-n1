# Independent verification: live-a-11

Codex independently re-scored the saved champion and regenerated both replay sides before switching the site hero on October 17, 2026. No model calls or final-split evaluations were used.

## Reproduce

```sh
npx tsx scripts/score.ts recorded/live-a-11/champion.json select
npx tsx scripts/score.ts recorded/live-a-11/champion.json train
npx tsx scripts/verify-live-a-11.ts
```

The verifier checks the current grader hash, each development day's goal checks, the baseline scores, the saved champion, and the complete regenerated simulation results, including package traces. It rewrites the public replay only after an exact comparison succeeds. Detailed output is in `independent-verification-live-a-11.json`.

| Check | Measured result |
|---|---|
| Grader | SIM 1.1.0, `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4` |
| Training objective, 6 days | 3,345.5 |
| Validation objective, 9 days | 3,283.44 |
| Full goal across all 15 development days | PASS |
| Shipped / mis-sorted / damaged per day | 100 / 0 / 0 |
| Slowest development day | 1,471 seconds, below the 1,500-second limit |
| Peak-202 replay, baseline | 1,581 seconds, 16 mis-sorts, 14 damaged, 6,456 travel cells |
| Peak-202 replay, run 11 | 1,184 seconds, 0 mis-sorts, 0 damaged, 2,742 travel cells |
| Both regenerated replay sides | Exact match, including all package traces |

Run 11 continued from run 7's champion and memory. Only `pack-B` changed, from `(0,4)` to `(3,5)`. Its nine proposal records contain 27 successful `measure_legs` receipts; the accepted `g1-route` proposal contains two. The new route-measuring tool and a clarified placement rule were introduced together, so their causal effects were not isolated.

The 81.8% reduction compares run 11's validation objective with Gen 0's 18,061.11. The equal-budget comparison against the code heuristic and random search belongs to run 7, which used 41 search evaluations. Run 11 added 29 search evaluations after run 7, for 70 combined; this count excludes separately metered baseline, attribution, and replay work. It is a continuation, not an equal-budget arm. The one-line code heuristic also eliminates mis-sorts, so that improvement is not uniquely attributed to the agents.

These are six training and nine validation days used during development. The final split remains locked for run 11. The separate shared-memory transfer result remains four losses in four valid comparisons.
