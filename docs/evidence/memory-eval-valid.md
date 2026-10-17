# Memory vs no-memory on fresh factories: valid result (NEGATIVE)

Evaluation `memeval-2026-10-17T19-41-04-350Z`, run on frozen commit `0d47833` and recorded in `recorded/memeval-2026-10-17T19-41-04-350Z/`. The earlier attempt `memeval-2026-10-17T19-33-01-589Z` is INVALID (infrastructure failure) and is kept only as a record.

**Design, locked before any arm ran:**
- **The only difference between arms:** MEM gets a frozen, experiment-backed Playbook (hash `704e8eae…`, 2 lessons from `live-a-7`); NOMEM gets an empty one.
- **Identical in both arms:**
  - starting layout and three Nemotron Super VL lenses;
  - 3 generations and 1 draft test;
  - research, isolated tests and the reflector all off;
  - the grader `493a1b03…`;
  - hard caps of **26 call attempts** (counted at dispatch) and **60 simulator evaluations** (counted in `meteredEvaluate`).
- **Factories:** fresh seeded factories F (seed 7001) and G (seed 7002).
- **Scoring:** each champion is scored once on the locked 20-seed final split. Arm order alternates by repeat.

**Caps held:** every arm used 18–19 of 26 attempts and 11–21 of 60 charged evaluations, with 0 provider failures, 0 budget failures and 0 arm-cap hits. All 4 pairs are valid.

| Pair | Order | No memory: final | Shared memory: final | Δ (MEM − NOMEM) | Outcome | Calls N/M | Sim evals N/M |
|---|---|---|---|---|---|---|---|
| factory-f r1 | NOMEM → MEM | 11,797.1 | 14,078.8 | +2,281.7 | loss | 18/18 | 19/17 |
| factory-f r2 | MEM → NOMEM | 10,497.4 | 12,698.4 | +2,200.9 | loss | 18/18 | 19/18 |
| factory-g r1 | NOMEM → MEM | 8,289.8 | 14,087.5 | +5,797.7 | loss | 18/18 | 21/11 |
| factory-g r2 | MEM → NOMEM | 11,994.0 | 14,426.0 | +2,432.0 | loss | 18/18 | 20/16 |

**Result:** 0 wins, 0 ties, 4 losses for shared memory. Median paired difference **+2,356.8** (range +2,200.9 to +5,797.7); positive means memory did worse. No arm met the goal or reached zero damage on the final split. **n = 4.**

**Interpretation** (an observation, not tuning; the code and Playbook stay frozen):
- Shared-memory arms submitted **7 of 24 invalid proposals**, against **2 of 24** without memory. Most were 2-cell spacing violations from putting pack stations right next to docks.
- Shared-memory champions left damage at the Gen-0 level in 3 of 4 arms.
- The frozen lessons came from a single factory. They include factory A's coordinates and "dock-adjacent" advice, which plausibly transferred badly. This experiment does not show that retained memory helps on fresh factories; it shows the opposite for this memory, with small n.

**Cost:** $0.07206 returned usage plus $0.00258 unknown-charge reservation. See `spend-accounting.json`.
