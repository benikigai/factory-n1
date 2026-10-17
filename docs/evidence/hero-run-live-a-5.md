# Hero run: live-a-5

Factory A (scattered fixed docks). 8 generations allowed; stopped after generation 4 (3 generations without an accepted change).
Models: designers and reflector `nvidia/NVIDIA-Nemotron-3.5-Super-VL`; research and hypothesis tests `nvidia/Nemotron-3.5-Lightning-30B-A3B`.
Simulator 1.1.0, grader hash `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`. Public data: `recorded/live-a-5/`.

## Outcome

| | Train (6 days) | Validation (9 days) | DoD |
|---|---|---|---|
| Gen-0 | 18,655.17 | 18,061.11 | fail |
| Code heuristic | 13,905.17 | 13,194.44 | fail |
| Random hill-climber, 23 evals (equal budget) | 13,847.67 | 13,092.00 | fail |
| **Agent champion g1-flow** | **11,311.17** | **10,733.22** | fail |

Replay scenario `peak-202` (test-split day, identical for both floors): shipped 100 → 100, makespan 1,581 → 729 s, mis-sorts 16 → 0, damaged 14 → 13.

## Generation by generation

| Gen | Outcome | Notes |
|---|---|---|
| 0 | research | 3 hypotheses with exact URLs; isolated tests: 1 no improvement (retired), 1 no change, 1 malformed JSON |
| 1 | **g1-flow accepted** | added pack stations near the sorter and docks, size coverage; prediction 11,000 vs measured 11,311 |
| 2 | both rejected | g2-capacity was 0.7% worse on validation (gate) |
| 3 | both rejected | g3-flow 0.6% short of the 1% margin; stall reflection wrote a code-receipted "avoid" lesson |
| 3 | re-plan research | 3 new hypotheses; tests: 1 no change, 2 malformed JSON (repair added afterwards) |
| 4 | both rejected | duplicate; validation not better |

Graded predictions: 0 of 7 refuted. Designers tested drafts with `simulate_layout` before predicting. Compare `live-a-1` (blind proposals): 4 of 7 refuted.
Typed tool calls: 8 of 8 proposals via `propose_layout`; 6 needed one repair after the task validator returned rule violations.
Crusoe prefix cache: cached prompt tokens rose each generation, from 5,440 of 21,256 (26%) to 10,880 of 28,886 (38%).

## All live runs on factory A (n = 5)

| Run | Validation: Gen-0 → champion | Change | Accepts | Random search, same evals | Calls | Inference $ | Notes |
|---|---|---|---|---|---|---|---|
| live-a-1 | 18,061 → 7,012 | −61.18% | 1 | 14,606 (9 evals) | 14 | 0.0042 | blind proposals; memory labels pre-fix (legacy) |
| live-a-2 | 18,061 → 9,631 | −46.68% | 1 | 18,064 (6 evals) | 14 | 0.0046 | memory/research fixes; promoted-by-citation bug (legacy labels) |
| live-a-3 | 18,061 → 10,345 (last written state) | −42.7% | 2 | n/a | n/a | ~0.026 | draft-test tool; crashed on a Crusoe 429 before final artifacts (2 consecutive accepts) |
| live-a-4 | 18,061 → 12,014 | −33.48% | 1 | 13,102 (29 evals) | 45 | 0.0275 | exploration prompt + stall reflection |
| live-a-5 | 18,061 → 10,733 | −40.57% | 1 | 13,092 (23 evals) | 36 | 0.0153 | fixed memory semantics + isolated hypothesis tests (hero, independently verified) |

Every run with comparators (4 of 5; live-a-3 crashed before computing them) beat both the code heuristic and the random hill-climber at equal simulator-evaluation budget on validation. Most of each run's gain came in generation 1. Runs 1–4 predate the memory-label fixes; the viewer shows their lessons as legacy labels.
