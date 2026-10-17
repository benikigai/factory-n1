# Factory N+1

A team of **NVIDIA Nemotron** agents on **Crusoe Managed Inference** redesigns a parcel fulfillment floor (receive → sort → pack → ship, 100 packages). The agents research real practices with **You.com**, share what they learn in a memory that keeps hypotheses separate from evidence, and test their own work against a frozen simulator. A change is kept only if it measurably beats the current floor on separate validation days.

Built at the Crusoe x Cerebral Valley **Recursive Agents Hackathon**, San Francisco, 2026-10-17. Everything in this repo was written during the event.

**Hero run:** `live-a-5` · [evidence](docs/evidence/hero-run-live-a-5.md) · [independent verification](docs/evidence/independent-verification-live-a-5.md) · [demo script](docs/demo/script.md)

## Result (live-a-5, independently re-scored)

| Layout | Development (train, 6 days) | Validation (9 days) | Goal met? |
|---|---|---|---|
| Gen-0 floor | 18,655 | 18,061 | ✗ |
| Code heuristic: pack stations accept all sizes | 13,905 | 13,194 | ✗ |
| Random hill-climber, **same 23 simulator evaluations** | 13,848 | 13,092 | ✗ |
| **Agent champion** (Nemotron 3.5 Super VL) | **11,311** | **10,733 (−40.6%)** | ✗ |

Objective is lower-is-better: makespan seconds + 300 per mis-sort + 600 per damaged package + 3,600 per unshipped + capex/100.

Replayed in 3D on the same peak day (`peak-202`), both floors ship 100/100, and:
- makespan drops from 1,581 to 729 s;
- mis-sorts drop from 16 to 0;
- damaged packages go from 14 to 13.

**The goal ("nothing damaged") is still not met**, and the viewer says so.

Run cost from returned usage: 36 model calls, $0.0153 inference plus about $0.01 for search. Codex independently re-scored every candidate and regenerated both replay traces exactly from the saved layouts and seed (grader `493a1b03…`).

## How it works

```
one-line goal
  └─ You.com research (Lightning calls research_factory_practice; every citation must exactly match a returned URL)
       └─ Shared memory: external hypotheses, kept separate from evidence
            └─ isolated test: each hypothesis -> its own 1-3 edit change -> simulator -> promoted only if it wins
  └─ each generation: 2 Nemotron Super VL designers read the same memory snapshot
       ├─ test drafts with simulate_layout (bounded; every test counts toward the eval budget)
       └─ submit with the typed propose_layout tool (rule violations come back for one repair)
  └─ frozen simulator scores every proposal (agents never score themselves)
       └─ gate: keep only if >=1% better on validation days with no goal-check regression
            └─ causal receipts: code scores each edit alone, so lessons cite measured causes
                 └─ reflector writes a lesson from those receipts (accepted or stalled) -> memory -> next generation
  └─ supervisor (code): duplicates, stalls -> targeted re-research -> stop
```

### Done Means Done
- **Goal as code:** the goal is a set of executable checks over simulator metrics. "All shipped" can never be removed.
- **Tests:** designers check their own drafts with a bounded test tool before submitting.
- **Predictions are graded:** every proposal predicts its score, and code compares it with the real result.
  - Blind proposals (`live-a-1`): **4 of 7 predictions were refuted**.
  - With the test tool (`live-a-5`): **0 of 7**.
- **Supervisor:** it catches loops (duplicate layouts), stalls (re-plans with targeted research) and decides when to stop.

### Shared Brain
- **Conflict-free:** an append-only log of memory operations, reduced deterministically into one Playbook every agent reads. Parallel writers never conflict, and the same log always gives the same Playbook.
- **Labeled by evidence:**
  - *untested external hypothesis* (cited web research);
  - *intervention improved in an isolated test* (the exact edits and the measured change are shown, not the whole prose claim);
  - *observed in an accepted experiment* (code receipts).
- **Citations aren't evidence:** when a designer cites a lesson in a winning proposal, that's recorded as a citation only.
- **Lean and cheap:** capped and byte-stable, so it works as a shared prompt prefix. Crusoe prefix-cache hits rose from 26% to 38% of prompt tokens across `live-a-5`'s generations.

### Version N+1
- **The layout improves under a ratchet,** and every accepted change carries code-computed receipts.
- **Gains mostly land in generation 1.** Later generations' candidates were often slightly better but failed the 1% validation margin.
- **Not shown yet:** that a learned solver policy beats a fresh one on *unseen factories*. Five fixed-dock factory layouts (`layouts/`, A–E) are ready for that test; it hasn't been run.

## Why Nemotron is load-bearing here
- **Nemotron 3.5 Super VL** writes every layout through typed tool calls. In `live-a-5`, 8 of 8 proposals arrived as valid tool calls; 6 needed one repair after the task validator returned rule violations.
- **Nemotron 3.5 Lightning** handles the cheap, bounded work: running research, turning sources into hypotheses, and building isolated test interventions.
- **The models are kept honest by code.** Nemotron also showed us why:
  - Lightning once invented a simulator re-run with made-up numbers ([evidence](docs/evidence/2026-10-17-live-roundtrip.md)).
  - Super VL credited a mis-sort fix to the wrong edit.

  Hence the frozen grader, graded predictions and causal receipts.

## Limits (stated plainly)
- A queueing simulation with synthetic rules (for example, fragile packages are damaged on conveyor legs over 12 cells). Not calibrated to a real facility.
- The goal checks still fail: damage remains. No completed-task claim.
- n is small: five live runs on factory A ranged from −33% to −61% on validation (table in the evidence doc). Runs 1–4 predate the memory-label fixes, and their lessons show as legacy labels.
- In `live-a-5`, none of the six web hypotheses improved the floor in an isolated test. Three couldn't be tested because of malformed JSON, which is now retried once.
- The 20-seed final split was never unlocked. No fine-tuning was run; experiment records are saved for later.

## Run it

```bash
npm ci
npm test                 # 29 tests: simulator identity, memory semantics, full loop offline, 3D trace math
npm run web              # 3D viewer at http://localhost:5173 (defaults to the recorded hero run)
npm run build:static     # static site in web/dist (viewer + recorded runs, no server code)
```

A live learning run needs a Crusoe key, plus a You.com key for research. Load them from a secret mount, never a plaintext file, and set explicit spend caps:

```bash
CALL_BUDGET=120 SPEND_CAP_USD=0.50 node --env-file=<path-to-secret-mount> --import tsx scripts/solve.ts 8 my-run 1
npm run publish-run -- my-run   # public copy in recorded/ (web excerpts stripped)
```

## Repo map
| Path | What |
|---|---|
| `src/sim/` | Frozen simulator and grader (SIM 1.1.0, hash recorded with every experiment) |
| `src/tasks/`, `layouts/` | Fixed-dock factory tasks A–E |
| `src/agents/` | Nemotron designers, reflector, rate-limit handling |
| `src/memory/` | Shared memory, You.com research, isolated hypothesis tests, causal receipts |
| `src/loop/` | The learning loop and what agents may observe |
| `src/baselines/` | Equal-budget random hill-climber |
| `src/llm/` | Crusoe client with spend reservation, typed tool turns, You.com adapter (built by Codex) |
| `web/` | three.js trace-exact replay (baseline vs champion, one clock) |
| `recorded/` | Public copies of recorded runs |
| `docs/evidence/` | Run evidence and independent verification |
