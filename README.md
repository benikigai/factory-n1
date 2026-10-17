# Factory N+1

A team of **NVIDIA Nemotron** agents on **Crusoe Managed Inference** redesigns a parcel fulfillment floor (receive → sort → pack → ship, 100 packages). The agents research real practices with **You.com**, share what they learn in a memory that keeps hypotheses separate from evidence, and test their own work against a frozen simulator. A change is kept only if it measurably beats the current floor on separate validation days.

Built at the Crusoe x Cerebral Valley **Recursive Agents Hackathon**, San Francisco, 2026-10-17. Everything in this repo was written during the event.

**Hero run:** `live-a-7` (independently re-scored by Codex) · earlier hero `live-a-5`: [evidence](docs/evidence/hero-run-live-a-5.md), [verification](docs/evidence/independent-verification-live-a-5.md) · [spend accounting](docs/evidence/spend-accounting.json) · [demo script](docs/demo/script.md)

## Result (live-a-7, independently re-scored)

| Layout | Development (train, 6 days) | Validation (9 days) | Goal met? |
|---|---|---|---|
| Gen-0 floor | 18,655 | 18,061 | ✗ |
| Code heuristic: pack stations accept all sizes | 13,905 | 13,194 | ✗ |
| Random hill-climber, **same 41 simulator evaluations** | 13,813 | 13,099 | ✗ |
| **Agent champion** (Nemotron 3.5 Super VL, QUALITY lens) | **6,946** | **6,083 (−66.3%)** | ✗ |

Objective is lower-is-better: makespan seconds + 300 per mis-sort + 600 per damaged package + 3,600 per unshipped + capex/100.

**Same peak day replayed in 3D (`peak-202`):** both floors ship 100/100.

| Metric | Gen-0 | Champion |
|---|---|---|
| Makespan | 1,581 s | 1,184 s |
| Mis-sorts | 16 | 0 |
| Damaged | 14 | 4 |

**Zero damage was NOT reached.**
- The champion ships every package with 0 mis-sorts on all 15 development and validation days.
- Damage remains on every training day (4–12) and on 7 of 9 validation days (0–17), so the goal check is FAIL.
- The remaining damage comes from one long sorter→pack route.
- The grader was frozen throughout (`493a1b03…`), and the run cost 61 model calls, $0.0288 inference plus 2 searches.

**Memory vs no-memory: no valid result.**
- The paired evaluation on two fresh factories (`memeval-2026-10-17T19-33-01-589Z`) failed for infrastructure reasons. A transient connection error retained a worst-case spend reservation that starved later arms of calls. It is labeled INVALID and is not evidence.
- Rerunning was not possible within the $0.50 authorization once uncertain reservations are counted conservatively. See the [status and reconciliation](docs/evidence/budget-and-memory-eval-status.md).

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
- **Not shown:** that retained memory makes the solver better on *unseen factories*. The experiment is built and locked:
  - a frozen Playbook hash;
  - fresh seeded factories F/G;
  - identical hard per-arm caps, enforced at model-call dispatch and simulator evaluation;
  - a locked final split.

  Its one run was invalid (see above).

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
- n is small: seven live runs on factory A ranged from −33% to −66% on validation. Runs 1–4 predate the memory-label fixes, and their lessons show as legacy labels.
- **Spend:** returned usage is $0.156 inference plus $0.09 base search. Counting unknown-charge reservations from failed requests at their recorded bounds gives a conservative $0.669 committed against the $0.50 authorization ([accounting](docs/evidence/spend-accounting.json)). Those reservations aren't released without billing evidence, and no further paid calls are being made.
- In `live-a-5`, none of the six web hypotheses improved the floor in an isolated test. Three couldn't be tested because of malformed JSON, which is now retried once.
- The 20-seed final split was never unlocked. No fine-tuning was run; experiment records are saved for later.

## Run it

```bash
npm ci
npm test                 # 29 tests: simulator identity, memory semantics, full loop offline, 3D trace math
npm run web              # 3D viewer at http://localhost:5173 (defaults to the recorded hero run live-a-7)
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
