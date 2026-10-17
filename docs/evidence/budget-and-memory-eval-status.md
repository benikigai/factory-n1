# Budget reconciliation and memory-eval status (2026-10-17 ~12:55 PT)

## Memory vs no-memory evaluation: INVALID (infrastructure failure)

Evaluation `memeval-2026-10-17T19-33-01-589Z`:
- **Setup:** frozen Playbook `704e8eae…` with 2 experiment-backed lessons from `live-a-7`. Fresh factories F and G, 2 repeats each, and identical hard caps of 26 call attempts and 60 simulator evaluations per arm.

**What went wrong:**
- In pair F-r1, the MEM arm hit a transient connection error. The client keeps a full 1M-token reservation ($0.1063) whenever billing is unknown, which pushed committed spend to the process's $0.21 cap.
- Every later call was refused. MEM in pair F-r1 made 6 calls against NOMEM's 18, and the other 6 arms made **0** calls and scored their Gen-0 layouts.
- The reported 1 loss and 3 ties are artifacts, **not** evidence about memory. Codex confirmed this independently.

**Fixes for any future run** (code frozen; no tuning on the exposed final outcomes):
- New text-only calls reserve a provable bound (request UTF-8 bytes + 4,096 template tokens, plus `max_tokens`); images keep the 1M bound.
- The harness aborts and writes `INCOMPLETE.json` on any provider or budget failure instead of scoring starved arms.

## Spend against the approved $0.50

| Item | Charged (returned usage) | Uncertain (retained reservation) | Searches |
|---|---|---|---|
| live-a-1, a-2, a-5 | $0.0242 | $0 | 6 |
| live-a-3 (crashed on a 429) | $0.0264 | $0.0526 | 2 |
| live-a-4 | $0.0275 | $0.0526 | 2 |
| live-a-6 | $0.0197 | $0.1063 | 2 |
| live-a-7 | $0.0288 | $0.0529 | 2 |
| memeval (invalid) | $0.0125 | $0.1063 | 0 |
| round-trips, single-shot probes, Codex checks | $0.0167 | $0.0525 (HTTP 500) | 4 |
| You.com before/after check | $0 | n/a | 2 |
| **Total** | **$0.1557** | **$0.4232** | **18 × $0.005 = $0.090** (+ an unconfirmed extraction surcharge on 5 searches) |

- **Conservative committed total: $0.669, which exceeds the $0.50 authorization by $0.169.**
- Returned usage plus base search cost is $0.246. The uncertain items are a 429, two connection errors and an HTTP 500, which are probably not billed, but that is **unproven**. They are not released retroactively.
- **No further paid runs** until actual usage is confirmed (for example in the Crusoe console's Intelligence Billing) or more budget is authorized.
