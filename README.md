# Factory N+1

An agent swarm on **Crusoe Managed Inference** designs a fulfillment floor, runs 100 packages through it, writes its own definition of done, and rebuilds the factory after every run. It keeps a change only if the factory gets measurably better on package days it has never seen.

Built at the Crusoe x Cerebral Valley **Recursive Agents Hackathon**, San Francisco, 2026-10-17. Everything in this repo was written during the event.

## Status

| Piece | State |
|---|---|
| Deterministic sim (receive → sort → pack → ship), metrics, seeded scenario splits | ✅ |
| Executable Definition of Done with non-negotiable floor checks | ✅ |
| Crusoe client + model/tool round-trip | ✅ written, awaiting API key |
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
cp .env.example .env   # add your Crusoe key
npm run roundtrip      # lists models, chat, and a real tool call into the simulator
```
