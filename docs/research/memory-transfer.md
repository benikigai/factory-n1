# Memory-Transfer Post-Mortem & Pre-Registered Relational Fix (`Task A1`)

**Evaluation ID:** `memeval-2026-10-17T19-41-04-350Z` (frozen commit `0d47833`, grader SHA-256 `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`, `SIM 1.1.0`)  
**Source Playbook:** `live-a-7` (`playbookHash: 704e8eaed9428a126a4a6b253a21df580c8faa06d07299a974801075f5f5c00a`)  
**Headline Result:** Shared memory (`MEM`) **lost 4 of 4 paired evaluations** (`0W / 0T / 4L`) against an identical no-memory (`NOMEM`) team on two fresh seeded factories (`factory-f` seed `7001`, `factory-g` seed `7002`), with a median paired final-split objective degradation of **+2,356.85** (range `+2,200.95` to `+5,797.70`; lower is better).

---

## 1. Root-Cause Diagnosis: Why Shared Memory Hurt on Fresh Factories

### 1.1 Exact Playbook Entries Transferred from Factory A (`live-a-7`)
The frozen Playbook (`704e8eae…`) injected into the `MEM` system prompt contained two verified lessons from Factory A:
1. **`VER-g1` (`observed-from-experiment`):**
   - **Text:** *"Relocate pack stations to dock-adjacent cells to eliminate route damage and reduce objective cost."*
   - **Attached Receipts:** `sort-1 (20,2) -> (12,7) [Δ -48.3]`, `add pack pack-A at (14,13) [Δ -2101.0]`, `add pack pack-B at (0,4) [Δ -1708.3]`, `add pack pack-C at (12,2) [Δ -1269.7]`.
2. **`VER-g2-avoid` (`observed-from-rejected-experiment`):**
   - **Text:** *"Moving pack-B to (0,2) did not reduce damage or objective; avoid this relocation."*
   - **Attached Receipt:** `pack-B (0,4) -> (0,2) [Δ 0]`.

### 1.2 Mechanism 1: "Dock-Adjacent" Wording Induced Chebyshev `< 2` Spacing Violations (`7/24` vs `2/24`)
- In `SIM 1.1.0` (`src/sim/config.ts`), `minSpacing = 2` requires every pair of stations $(u, v)$ to satisfy $\max(|x_u - x_v|, |y_u - y_v|) \ge 2$. A cell literally "adjacent" (distance `1`) to a shipping dock is **illegal**.
- On Factory A, `ship-B` sits at `(0,0)` and `pack-B` was placed at `(0,4)` (distance `4`, legal), yet the reflector summarized that edit in `VER-g1` as *"dock-adjacent cells"*.
- When `MEM` designers read `VER-g1` on Factories F and G, they interpreted *"dock-adjacent"* literally, placing pack stations `1` cell away from the new shipping docks.
- **Measured impact:** Across the 4 paired runs (`24` designer turns per arm), **`MEM` submitted `7 / 24` (`29.2%`) invalid proposals**—mostly 2-cell spacing violations next to docks—compared to only **`2 / 24` (`8.3%`) in `NOMEM`** (`3.5×` higher invalid rate). Because each arm operated under a hard cap of `26` model calls, repair turns consumed call budget and caused every arm to terminate after Generation 2 (`18–19` calls used, next gen worst-case `12 > 26`).

### 1.3 Mechanism 2: Coordinate Anchoring + One-Sided Proximity Broke the Two-Hop Leg Invariant
- Fragile damage occurs whenever **any** single Manhattan conveyor leg (`receiving -> sorter`, `sorter -> pack`, or `pack -> shipping`) exceeds `SIM.fragileMaxLeg = 12` cells:
  $$d_{\text{Manhattan}}(u, v) = |x_u - x_v| + |y_u - y_v| > 12$$
- `VER-g1` told designers to push pack stations next to the shipping docks and listed Factory A's absolute coordinates (`(12,7)`, `(14,13)`, `(0,4)`, `(12,2)`), without stating that the **upstream** `sorter -> pack` leg must simultaneously stay $\le 12$ cells.
- Pulling a pack station toward a distant dock on Factories F and G stretched the `sorter -> pack` leg past `12` cells, leaving 20-day final-split fragile damage stuck at **`361` damaged packages (the Gen-0 baseline level) in 3 of 4 `MEM` arms**, whereas `NOMEM` reduced damage to **`163–280` packages**:

| Pair | Order | `NOMEM` Final Obj | `MEM` Final Obj | $\Delta$ (`MEM - NOMEM`) | `NOMEM` Damaged (20d) | `MEM` Damaged (20d) | `NOMEM` Charged Evals | `MEM` Charged Evals |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `factory-f r1` | `NOMEM → MEM` | `11,797.10` | `14,078.80` | `+2,281.70` (loss) | `268` | `361` (Gen-0 level) | `19` | `17` |
| `factory-f r2` | `MEM → NOMEM` | `10,497.40` | `12,698.35` | `+2,200.95` (loss) | `230` | `310` | `19` | `18` |
| `factory-g r1` | `NOMEM → MEM` | `8,289.80` | `14,087.50` | `+5,797.70` (loss) | `163` | `361` (Gen-0 level) | `21` | `11` |
| `factory-g r2` | `MEM → NOMEM` | `11,994.05` | `14,426.05` | `+2,432.00` (loss) | `280` | `361` (Gen-0 level) | `20` | `16` |

---

## 2. Proposed Fix: Relational Lesson-Abstraction Rule

To transfer across factories with different dock positions and grid geometries, lessons written to the Shared Playbook must be **coordinate-free relational invariants** validated by a deterministic lint gate before storage:

### Rule R1 — Forbid Absolute Coordinates and Station IDs in Lesson Text & Portable Receipts
- **Reject** any reflector lesson text containing integer coordinate pairs `(x, y)` or task-specific station literals (`pack-B at (0,4)`).
- **Transform** concrete edit receipts (`add pack pack-A at (14,13)`) into **relational receipts** computed by code at reflection time:
  ```text
  add pack(zone=A, sizes=S,M,L): d_manhattan(sorter, pack)=8, d_manhattan(pack, dock_A)=9, min_chebyshev=2 -> Δalone = -2101.0
  ```

### Rule R2 — Express Spatial Lessons as Two-Hop Midpoint Relations, Never One-Sided "Dock-Adjacent" Advice
- Replace one-sided proximity phrasing (*"place pack stations in dock-adjacent cells"*) with the true two-hop conveyor relation plus explicit spacing clearance:
  > **Relational Form (`VER-rel-1`):** *"For each shipping zone $Z \in \{A,B,C\}$, place a dedicated pack station Accepting `(S, M, L)` near the Manhattan midpoint between its feeding sorter and `ship-Z` such that both `d_manhattan(sorter, pack) <= N` and `d_manhattan(pack, ship-Z) <= N` while maintaining `chebyshev_distance >= 2` from all fixed docks and stations."*

---

## 3. Pre-Registered Rerun Protocol (Do Not Run — Awaits Ben's Authorization)

### 3.1 Hypotheses
- **Primary Hypothesis ($H_1$):** A frozen Playbook containing **relationally abstracted lessons (`REL-MEM`)** from `live-a-7` achieves a lower (better) 20-seed `final` objective than `NOMEM` across fresh seeded factories (`factory-h` seed `7003`, `factory-i` seed `7004`).
- **Secondary Diagnostic Hypothesis ($H_2$):** `REL-MEM` reduces the invalid-proposal rate (`validateForTask` failures) from `29.2%` (`7/24` in coordinate `MEM`) to $\le 10\%$ (matching or beating `NOMEM`'s `8.3%`).

### 3.2 Experimental Design & Locked Parameters
- **Factories (Untouched):** `factory-h` (`seed 7003`) and `factory-i` (`seed 7004`), generated via `makeFactoryTask` with randomized fixed dock positions never seen during development or in `memeval-2026-10-17T19-41-04-350Z`.
- **Repeats & Pairing:** `3` paired repeats per factory (`n = 6` pairs total, `12` runs), alternating arm execution order (`NOMEM → REL-MEM` on odd repeats, `REL-MEM → NOMEM` on even repeats).
- **Identical Arm Caps & Settings (Locked):**
  - Model: `nvidia/NVIDIA-Nemotron-3.5-Super-VL` (`flow 0.3`, `quality 0.5`, `capacity 0.8`)
  - Generations: `3`, Probes: `1` (`simulate_layout`)
  - `research: false`, `isolatedTests: false`, `reflector: false`
  - Hard per-arm caps: **`maxCalls = 26`**, **`maxSimEvals = 60`**
  - Held-out evaluation: single scoring pass on the locked 20-seed `final` split (`9001..9020`) under grader `493a1b03…`.

### 3.3 Success Criteria, Stop Rules & Cost Estimate
- **Win / Tie / Loss Threshold:** A pair is a **Win** for `REL-MEM` if `(REL-MEM.final.objective - NOMEM.final.objective) / NOMEM.final.objective <= -0.01` ($\ge 1\%$ better), a **Loss** if $\ge +0.01$, and a **Tie** otherwise.
- **Success Criterion:** `REL-MEM` wins at least **5 of 6 pairs** with a negative median paired difference ($\text{median}(\Delta) < 0$) and zero incomplete pairs.
- **Stop Rule:** Abort immediately if any provider 5xx/timeout invalidates a pair or if cumulative spend reaches the run's `SPEND_CAP_USD = 0.15`.
- **Cost Estimate:** `12 arms × ~18.5 calls/arm = ~222 calls` on `Super VL` $\approx$ **`$0.108` returned inference usage** (`~$0.112` conservative with reservations), 0 You.com searches (`$0.00`), ~6.5 minutes wall-clock time.
