# Goal compiler evidence

The compiler converts a one-line goal into typed checks, validates untrusted JSON with at most one repair, and adds the code-owned `unshipped == 0` floor. The independent auditor uses exactly `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`; the planner uses exactly `nvidia/NVIDIA-Nemotron-3.5-Super-VL`. Missing or failed auditor calls veto approval. Neither role uses the general model resolver's fallback.

Physical bounds use frozen simulator constants, arrivals, fixed dock geometry, maximum task station capacity, and the minimum legal capital cost. They never use model estimates or a proposed layout. An impossible contract returns `escalate` with the violated numeric bound and proof. Necessary bounds passing means only that this calculation has not ruled the goal out; it is not evidence of an achieving layout.

Approved definitions include a SHA-256 hash of the exact canonical contract and immutable floor. `assertApprovedDoD()` rejects altered serialized contracts. `tighteningErrors()` allows later contracts only when they imply every prior bound and add a strict restriction. Changing every-scenario checks to an average, deleting checks, or equivalent rewording is rejected.

## Offline validation

Run:

```sh
node --import tsx --test test/dod-compiler.test.ts
node --import tsx scripts/goal-compiler.ts --offline
```

The offline JSON is at `docs/evidence/goal-compiler.offline.json`. It is a mocked demonstration and spent $0. All 15 compiler tests pass. They cover the valid compiler path, exactly one repair, malformed and nonfinite JSON, floor replacement, the 16-goal-check boundary after the code adds its floor, vacuity, contradiction, omitted goals rejected by the auditor, impossible deadlines, unavailable models, changed hashes, relaxed thresholds, every-to-mean weakening, and lower bounds checked against simulator measurements. `npm run typecheck` also passes.

A separate bound check ran 672 valid-layout simulations across all seven factory geometries, both baseline and all-size/all-zone packing variants, all four arrival profiles, package counts 1/2/9/100, and seeds 7/42/313. No measured metric violated a computed bound. This checks the bounds against the actual grader; it does not establish that a requested goal is achievable.

## Live round

The single authorized two-goal live round ran on October 17, 2026 at 20:28 UTC. Both requested model IDs were present in the provider catalog and were used. It made **4 model calls**, spent **$0.0004162**, and left **$0 in uncertain reservations**. Both goals were rejected by validation. The raw record remains unchanged at `docs/evidence/goal-compiler.live.json`.

- The 25-minute goal produced a valid planner definition, but the auditor response failed the original strict verdict/reasons schema. The raw response was not captured, so its exact shape is unknown; an empty approval-reasons array is a hypothesis, not an observed fact.
- The one-second goal also included `shipped == 100`. The original validator treated this redundant floor-derived check as vacuous and rejected it after one repair, before producing the intended impossibility escalation.

The failures led to two offline corrections: an approval may have absent or empty reasons, while a veto still requires an explanation; and checks already implied by the all-shipped floor are removed before checking whether a meaningful goal constraint remains. An impossible deadline alongside redundant `shipped == 100` now escalates in an offline regression test. Invalid auditor output now retains a bounded response preview for diagnosis. These corrections have **not been verified in another live round**, and no second round was run.

The command used for the completed round was:

```sh
CALL_BUDGET=8 SPEND_CAP_USD=0.05 node --env-file=<1Password mount> --import tsx scripts/goal-compiler.ts --live
```

The implementation agent made no provider calls; the parent agent ran the authorized round. The runner's intended success cases are an audited first goal and a one-second impossibility proof. The existing live evidence proves neither success case. A future live verification needs fresh authorization.

## Static evidence contract

The JSON wrapper is `{schemaVersion:1, kind:"goal-compiler-round", mode, generatedAt, scenarioSplit, taskId, results, spend, usage, notes}`. Each result contains `{schemaVersion:1, status, goal, models, planner, audit, feasibility, approved, reasons}`. Status is `approved`, `rejected`, or `escalate`. `approved` is null or `{hash,dod}`. `feasibility` contains `{status,bounds,violations}`; each bound is `{scenarioId,metric,lower,upper,proof}` with null for an unbounded upper limit. Each violation contains `{checkId,scenarioIds,proof}`. These are plain JSON values suitable for a static page.

Solver integration is applied in `src/loop/solve.ts` on the isolated `codex/final-site` branch with Ben's explicit approval. `docs/integration/solve-checkpoint.patch` retains the reviewed patch record. The solver persists the approved hash alongside checkpoints and refuses modified contracts before simulator evaluation. The approved goal must match the task's goal. Existing historical runs retain their original hand-written definition. Until designer probe and research helper evaluations receive the same approved definition, a custom approved contract requires `research:false` and `probes:0`; the integration rejects other combinations before work begins. An approved contract with the same canonical hash as the normalized default remains compatible with the existing research and probe paths.
