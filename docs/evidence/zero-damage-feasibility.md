# Zero damage: why the agents missed a one-move fix

**Date:** 2026-10-17, about 13:45 PT. **Grader:** SIM 1.1.0, hash `493a1b03…` (unchanged).
**Data:** train (6 days) and select (9 days) only. The final split stays locked.

## What the agents did

`live-a-8`, `live-a-9` and `live-a-10` all continued from the `live-a-7` champion. None of the three was accepted.

| Run | Designers | Calls | Model spend | Result |
|---|---|---|---|---|
| live-a-8 | default designers + research | 58 | $0.030 | no change |
| live-a-9 | route fixer (v1), quality, flow | 51 | $0.028 | no change |
| live-a-10 | route fixer (v2: bound both legs), quality, flow; research off | 42 | $0.027 | no change; 6 of 9 proposals were duplicates |

In `live-a-10`, every pack-B proposal went to the dock wall (x = 0). The model's leg arithmetic was wrong each time. Routes are Manhattan distance, and the sorter is at (12,7).

| Proposal | Model's claim | Actual legs (sorter→pack-B / pack-B→ship-B) | Measured |
|---|---|---|---|
| pack-B → (0,9) | "15 cells to 3", then "15 to 14, at or below 12" | 14 / 9 | still damaged; objective +1.33 |
| pack-B → (0,2) | "15 cells to 12" | 17 / 2 | still damaged; objective unchanged |

## What the simulator says (code search, not an agent result)

This was a local sweep. It moved only pack-B on the `live-a-7` champion and scored every legal cell. It made no model calls and spent $0. It is a feasibility probe: it is not a run, a champion or a demo claim.

- pack-B has **295** legal cells. **47** of them give zero damage on all 6 training days.
- The rule is exact: a cell has zero damage **if and only if both legs are ≤ 12 cells** (47 of 47, no exceptions). This is the same L = 12 the route lens was told to compute.
- Only **4 of 57** cells on the dock wall qualify. Every agent proposal was on the wall.
- Example: pack-B at (6,4), with legs 9 and 10, **passes the full goal on all 15 development days**. Select objective is 3,283, versus 6,083 for the champion and 18,061 at the start.

## Reading

The search space contains the fix, and the designers had the right rule. They failed on spatial arithmetic, and they were biased toward the dock wall. Only receiving and shipping must sit on the perimeter; pack stations can go anywhere.

Better wording did not close the gap: route lenses v1 and v2 both failed. The fix that matches the project's thesis is a measuring tool: code computes leg lengths for any draft, the same way code already computes the score. That has not been built or run yet.

Reproduce: run the pack-B sweep against `runs/live-a-7/champion.json` with `evaluate(layout, "train" | "select")` from `src/sim/evaluate.ts`.
