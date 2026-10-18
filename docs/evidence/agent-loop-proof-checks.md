# Run 7 search comparison and accounting

Run `live-a-7` scored 6,083.44 on the nine validation days, compared with 13,194.44 for the simple code fix and 13,098.67 for random search. Lower objective is better. The objective combines completion time, penalties for damaged, mis-sorted and unshipped packages, and machine cost. It is not a monetary bill or a package count.

The code fix makes pack stations accept all package sizes. Random search proposes random layout edits and keeps improvements. These are different baselines, not three runs with identical total computation.

| Recorded counter | Value | Meaning |
| --- | ---: | --- |
| `simEvals` | 41 | Legacy search counter used to set the random-search evaluation allowance |
| `simCalls.evaluations` | 55 | All metered agent evaluation batches before comparators, including checks and diagnostics |
| `simCalls.scenarioSims` | 340 | Individual simulated package days inside those batches and replay generation |

An evaluation batch can simulate several days. The search counter and full meter use different accounting rules; do not add 41 and 55 or treat 41 as a complete compute bill. The simple code fix does not use a 41-step search. Total compute, model calls and elapsed time were not matched across all three methods.

The result supports a better validation score for the agent layout in this recorded comparison. It is not a controlled equal-total-compute experiment or a claim about performance on new factories. Run 7 still failed the full goal. Run 11 later continued from it with additional work, so its result also does not belong in this search-budget comparison.

Sources: [run 7 summary](../runs/live-a-7/summary.json), [run 7 replay](../replay.html?run=live-a-7). The source implementation records the search counter and full meter separately in `src/loop/solve.ts` before constructing the comparators.
