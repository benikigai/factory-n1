# Factory N+1: Spec (as built)

**Status:** As-built record, 2026-10-17 ~13:15 PT.
- **Approval history:** the earlier planning draft (Option B, 12 tasks) was never formally approved. The build followed Ben's direct execution orders (Codex handoffs `crusoe-ready-v1`, `factory-n1-build-v1`, capsule v2, then the zero-damage and memory-evaluation directives).
- **Scope:** this document records what was built, the proof for each claim, and what is still open. Hashes are post-rewrite; see `docs/evidence/commit-hash-map.md`.
- **Event:** Crusoe × Cerebral Valley **Recursive Agents Hackathon**, SF. Form theme: **Version N+1**. Prize targets: overall, plus **Best Use of Nemotron**.

---

## 1. One line, and what is proven

**A team of NVIDIA Nemotron agents on Crusoe redesigns a parcel fulfillment floor. It researches real practice with You.com, shares evidence-labeled memory, and checks its own work against a frozen simulator. A change survives only if code measures it as better.**

| Claim | Status | Proof |
|---|---|---|
| Agents beat a code heuristic and blind search at the **same simulator budget** | ✅ every run with comparators | `live-a-7`: validation **18,061 → 6,083 (−66.3%)** vs heuristic 13,194 and random search 13,099 with the same 41 evaluations. Independently re-scored (Codex) |
| One frozen grader everywhere | ✅ | SIM 1.1.0, hash `493a1b03…` in every record; replays regenerate exactly |
| Model claims are checked, not trusted | ✅ | CLAIM REFUTED: **4/7** blind predictions (`live-a-1`) vs **0/7** after designers test drafts (`live-a-5`) |
| Zero damage | ❌ **not reached yet** | Best champion ships 100/100 with 0 mis-sorts on all 15 days; damage 4–12 per training day, all from one 15-cell route. `live-a-8` and `live-a-9` made no progress: the route fixer shortened sorter→pack-B but created a 17-cell pack-B→ship leg, so damage moved. `live-a-10` (lens revised to bound both legs) also made no change; 6 of 9 proposals were duplicates. A local sweep shows the fix exists: 47 of 295 pack-B cells give zero damage, exactly those with both legs ≤ 12, and pack-B at (6,4) passes the full goal on all 15 development days. The designers stayed on the dock wall and mis-measured legs ([evidence](../evidence/zero-damage-feasibility.md)) |
| Retained shared memory helps on fresh factories | ❌ **refuted for this memory** | Pre-registered paired test, equal hard caps: **0 wins / 0 ties / 4 losses**, median +2,357 (worse), n = 4 |
| Spend is controlled and auditable | ✅ | Every run capped; `spend-accounting.json` splits returned usage ($0.313) from unknown-charge reservations ($0.432); $0.844 committed on the conservative basis against a $2.00 working ceiling |

**Our perspective:** recursive self-improvement only matters if it's **honest**. The model proposes and the grader disposes. Every on-screen number is computed by code, and negative results are shown as prominently as wins. That's what lets a judge trust the −66%.

---

## 2. Architecture

```
goal (executable checks; the all-shipped floor check can't be removed)
 ├─ You.com research ─ Lightning calls research_factory_practice
 │    boost_domains · highlights · mirror dedupe · search_uuid/latency · exact-URL citations (1 repair)
 │    hypotheses must name a layout lever ─▶ isolated test: 1–3 edit change vs champion, scored by code
 ├─ Shared Brain ─ append-only ops ─deterministic reduce─▶ byte-stable Playbook (prompt-prefix cacheable)
 │    labels: untested · intervention-improved · observed (accepted) · observed (REJECTED); citations ≠ evidence
 └─ each generation: Super VL designer lenses read the same snapshot
      simulate_layout (bounded draft tests) · propose_layout (typed tool + rule repair) · predicted score
   ▶ frozen grader on 6 train days ▶ gate: ≥1% better on 9 validation days, no goal-check regression
   ▶ causal receipts (each edit scored alone) ▶ reflector lesson ▶ supervisor: duplicates, stalls, re-research, stop
   ▶ hard caps: calls at dispatch, simulator evaluations at evaluate ▶ artifacts per run (events, experiments, replay, memory)
```

The **3D viewer** (plain three.js) replays the *exact scored traces*: the same package IDs, station intervals and L-shaped legs, with baseline and champion side by side on one clock.

---

## 3. Technical innovations, each with proof

1. **We audited the grader before trusting it.**
   - Packages were indexed by ID into arrival-sorted arrays, which scrambled **98 of 100** traces (Codex audit).
   - Fixed with a regression test that **fails when the bug is restored** (`e88bd4b`).
   - The grader was then frozen: SIM 1.1.0, source hash in every record, 20 fresh `final` seeds behind `unlockFinal()`.
2. **Causal receipts.**
   - Every accepted change is split into atomic edits, and each is scored alone.
   - Super VL credited a mis-sort fix to a sorter move; the receipts showed the size-coverage edits did it (≈ −4,700 each).
   - Lessons and the UI may cite only receipts.
3. **Predict, then verify.**
   - In the first live call, Lightning **invented a simulator re-run** with fake numbers; the grader refuted it.
   - Every proposal now carries a prediction, graded against the real result: 4/7 refuted when designing blind, 0/7 with bounded draft tests.
4. **Evidence-labeled shared memory** (event-sourced, conflict-free). Two live bugs found and fixed:
   - **Promotion by citation:** a hypothesis cited by a winning proposal was promoted to verified. Now only its own isolated test promotes it, labeled "intervention improved", which supports those edits rather than the whole prose claim.
   - **Rejected lesson labeled as accepted:** a lesson from a rejected change carried only its training-day gain, and designers repeated that failed move 4×. Now it's "OBSERVED in a REJECTED experiment" with its validation result.
5. **Observation design.**
   - Damage used to be blamed on every route a package traveled.
   - Arrival inspection now names the route it arrived damaged from (the threshold rule stays hidden). The new QUALITY lens then built zone-dedicated pack stations: **−66%**.
6. **Honest baselines.**
   - Results always appear next to a one-line code heuristic and an equal-budget random hill-climber.
   - Blind search wins only with roughly 100× the budget, and then **overfits**: it failed unseen test days on both seeds.
7. **Audited budgets.**
   - Calls are capped at dispatch, counting attempts including retries. Simulator evaluations are capped in `meteredEvaluate` (probes, tests, attribution).
   - Reservations are a provable byte bound per request; unknown-charge reservations stay counted until billing proves otherwise.
   - One evaluation was invalidated by a transient failure, kept labeled INVALID, and rerun validly.
8. **Pre-registered negative result.**
   - The memory test was locked first: frozen Playbook hash, seeded fresh factories, alternating order, equal hard caps, final split scored once.
   - Memory **hurt**: 7/24 invalid proposals vs 2/24, because lessons carried factory A's coordinates. It's reported rather than tuned away.

---

## 4. Sponsor toolsets: what each uniquely contributed

| Sponsor | Unique capability used | Measured | Insight |
|---|---|---|---|
| **Crusoe Managed Inference** | One OpenAI-compatible endpoint serving **Nemotron 3.5 Super VL** a day after launch, plus Lightning; **MemoryAlloy prefix caching** | ~$0.0005 per call (`live-a-7`: 61 calls, $0.029). Cached prompt tokens grew with the byte-stable Playbook: **39%** (`live-a-7`), **49%** (`live-a-8`, 120,768 of 246,985) | Resolve IDs from `/v1/models` (docs casing differs); handle 429s and dropped connections; forced named `tool_choice` returned HTTP 500, auto works |
| **NVIDIA Nemotron** | **Super VL** designs and reflects through typed tool calls; **Lightning** does cheap research and test interventions; thinking off for strict JSON | Super VL drove every accepted change (best −66.3%); `live-a-5`: 8/8 proposals were valid tool calls, 6 after one rule repair | Strong at structured proposals under tool contracts; also over-claims and misattributes causes, which is why predictions are graded and edits receipted |
| **You.com** | Search with **boost_domains**, token-budgeted **highlights**, `search_uuid`/latency receipts; exact-URL citation validation | Same-query before/after: duplicate mirror article removed, highlights and receipts present; a shortened-URL citation was caught and repaired | Boosting didn't surface engineering sources for our query. Web ideas count only after an isolated simulator test, and none improved the floor in our runs |

Deliberately not used: NemoClaw/OpenShell (sandbox infrastructure, off the critical path), Switchyard (routing done in code), Cosmos (no fit for a queueing simulator), fine-tuning (deferred; every proposal is logged as future training data).

---

## 5. The three problem statements

| Track | Built | Proof | Gap |
|---|---|---|---|
| **Version N+1** | Ratchet over generations; continue-from-run across runs; equal-budget comparators; lens set as solver policy | `live-a-7` −66.3%; `live-a-3` had 2 consecutive accepts | Gains land mostly in gen 1; retained memory didn't transfer (0/4) |
| **Done Means Done** | Executable goal checks with a fixed floor; frozen grader; predict-then-verify; supervisor stop/re-plan; hard caps; INVALID/INCOMPLETE labels | Goal FAIL shown honestly; refutation rates; invalid run labeled and rerun | The goal is hand-written; the goal compiler (planner, auditor, feasibility proofs) is in progress (Codex) |
| **Shared Brain** | Event-sourced memory, evidence labels, citations ≠ evidence, byte-stable prefix | Cache up to 49%; two memory bugs found, fixed and tested | Quality gain on fresh factories refuted (n = 4) |

---

## 6. Runs (factory A unless noted; validation objective, lower is better)

| Run | Change | Validation | Notes |
|---|---|---|---|
| live-a-1 | blind proposals | 18,061 → 7,012 (−61.2%) | 4/7 refuted; legacy memory labels |
| live-a-2 | memory/research fixes | → 9,631 (−46.7%) | promotion-by-citation bug (found later) |
| live-a-3 | draft-test tool | → 10,345 (−42.7%) | 2 consecutive accepts; crashed on a 429 |
| live-a-4 | exploration, stall reflection | → 12,014 (−33.5%) | gate rejected 0.6–0.7% gains |
| live-a-5 | isolated hypothesis tests | → 10,733 (−40.6%) | 0/7 refuted; independently verified |
| live-a-6 | QUALITY lens, inspection fix | → 9,817 (−45.7%) | mislabeled rejected lesson repeated 4× |
| **live-a-7** | rejected-lesson labels, 2 draft tests | **→ 6,083 (−66.3%)** | **hero**; independently verified |
| live-a-8 | continue from a-7, 3 draft tests | no change | duplicates; 49% cache hits |
| live-a-9 | continue from a-7, ROUTE FIXER lens, no research | no change | damage moved to the pack→ship leg; 429s from research handled |
| live-a-10 | revised route lens (both legs), no research | no change | 42 calls, $0.027; leg arithmetic wrong (claimed 12, actual 17); zero-damage cells exist ([feasibility](../evidence/zero-damage-feasibility.md)) |
| memeval-…19-33-01 | memory vs none, F/G | INVALID | connection error starved arms |
| **memeval-…19-41-04** | memory vs none, F/G | **0W/0T/4L** | valid negative result |

---

## 7. Work log (author time, PT)

| Time | Commit | Milestone |
|---|---|---|
| 11:02 | `67237fe` | Deterministic simulator, executable goal checks, Crusoe client |
| 11:10 | `4bac5aa` | Live Nemotron tool call into the simulator; **Lightning fabricates a re-run** |
| 11:32 | `e88bd4b` | **Grader bug fixed** (98/100 traces), grader frozen, final seeds locked |
| 11:36–11:38 | `8993389` · `ffb95a4` · `18877e4` | Codex provider slice: reservations, typed tool turns, live You.com, exact citations |
| 12:02 | `72e76d6` | Full loop: research → memory → Nemotron → grader → 3D replay |
| 12:20 | `22c8090` | Argon's You.com upgrade, verified by before/after |
| 12:27–12:32 | `2e33923` · `29103a2` · `c21436e` | Damage-attribution and rejected-lesson fixes; locked memory experiment; hard caps |
| 12:37 | `fc328ae` | First memory evaluation **INVALID**, labeled; byte-bound reservations |
| 12:40–12:47 | `0d47833` · `3336bbc` | Fail-fast rules; **valid memory evaluation: negative** |
| 13:00–13:10 | `fd0c6f1` · `0959adf` | Continue-from-run, route-fixer lens, team briefs |
| 13:15–14:20 | `0a3d731` · this branch | As-built spec; landing "proof board" with live goal checks on the recorded replay; static build verified |

**Independent verification (Codex):** exact replay and re-scoring of `live-a-1/2/4/5/7`, cap audits, validity audits of both memory evaluations.

---

## 8. Demo-relevant insights

1. **"The model lied, the grader caught it."** Lightning's invented re-run is the opener.
2. **"Measure the edit, not the story."** Causal receipts corrected Super VL's wrong explanation.
3. **"Testing your own drafts makes you honest."** Refuted claims fell from 4/7 to 0/7.
4. **"Memory can make agents worse."** Factory-specific lessons transferred badly (0/4), which is why evidence is labeled and tests are pre-registered.
5. **"Every hero number was recomputed by someone else."**

---

## 9. Ownership and next

| Owner | Now |
|---|---|
| Claude | As-built spec, high-design static site, zero-damage continuation, integration |
| Codex Sol | Stage checkpoints and resume; goal compiler (planner, auditor, feasibility); static agent-team view |
| Argon 4 | Memory-transfer post-mortem and pre-registered fix; Screen Studio kit; site QA |

**Open:** zero damage; goal compiler; static deploy at the 3:45 freeze (Ben's go-ahead); submission by 5:00.

Research notes: `factory-n1-research.md`. Briefs: `docs/team/briefs-2026-10-17.md`.
