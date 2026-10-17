# Factory N+1

An agent swarm on **Crusoe Managed Inference** designs a fulfillment floor, runs 100 packages through it, writes its own definition of done, and rebuilds the factory after every run. It keeps a change only if the factory gets measurably better on package days it has never seen.

Built at the Crusoe x Cerebral Valley **Recursive Agents Hackathon**, San Francisco, 2026-10-17. Everything in this repo was written during the event.

## Status

| Piece | State |
|---|---|
| Deterministic sim (receive → sort → pack → ship), metrics, seeded scenario splits | ✅ |
| Executable Definition of Done with non-negotiable floor checks | ✅ |
| Crusoe client + live model/tool round-trip (Nemotron 3.5 Super VL + Lightning), per-process spend caps | ✅ [evidence](docs/evidence/2026-10-17-live-roundtrip.md) |
| Agent loop (planner, auditor, designer swarm, reflector, librarian) | ⏳ |
| 3D replay (three.js) | ⏳ |

## How It Scores

- **The simulator is the grader.** Agents propose layout JSON; only code scores it. Agents never self-score.
- **Splits:**
  - `train`: what agents see.
  - `select`: the gate a change must pass to be kept.
  - `test`: untouched until the final before/after. It includes a **skewed** demand profile that never appears in train or select.
- **Objective** (lower is better): makespan + 300·mis-sorts + 600·damaged + 3600·unshipped + capex/100.
- **Gen-0 baseline vs a hand-built reference** (the reference lives in `test/fixtures` and is never shown to agents):

| Layout | Train objective | DoD |
|---|---|---|
| `layouts/baseline.json` | 17,915 | ✗ 18 mis-sorts, 26 damaged, 27-min makespan |
| hand-built reference | 3,509 | ✓ (also ✓ on unseen test days) |

## Run

```bash
npm install
npm test
npm run score -- layouts/baseline.json train
# Load the key from a secret mount (we use a 1Password environment) rather than a plaintext .env.
# Spend is capped per process; raise CALL_BUDGET / SPEND_CAP_USD explicitly for longer runs.
CALL_BUDGET=5 SPEND_CAP_USD=0.05 node --env-file=<path-to-secret-mount> --import tsx scripts/roundtrip.ts
```
