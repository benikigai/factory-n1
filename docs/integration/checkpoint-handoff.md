# C1 checkpoint integration handoff

Prepared 2026-10-17 for Claude and the parent Codex task. The shared `src/loop/solve.ts` has not been edited.

## Apply

Apply `docs/integration/solve-checkpoint.patch` to `src/loop/solve.ts`. The patch also contains the agreed C2 `approvedDoD` integration, so do not apply a second goal-contract patch.

Patch SHA-256: `4571d155bd98394d252b972071cb2f7f1a65341ce7a53141f985bbdc5f42cadc`.

`git apply --check docs/integration/solve-checkpoint.patch` passed against commit `bef0265f74b99ea62af3f31e4e8a8fada03cdc8d` and the current shared source.

## Behavior

- `manifest.json` binds the task, effective options, models, process caps, approved goal contract, git commit, and grader hash. A changed manifest refuses the existing run ID before model calls. A directory containing any known solver or evaluation artifact without a manifest also refuses reuse; existing artifact bytes are preserved.
- `checkpoint.json` atomically commits generation state, champion and evaluations, memory operations, accepted/rejected proposals, curve, seen hashes, stalls, research state, and runtime counters. Resume starts at the next committed generation.
- Journal byte offsets and prefix hashes remove only an interrupted generation's trailing writes. Changed committed journal bytes refuse resume.
- `runtime.json` preserves simulator counters, call attempts, and provider reservations before dispatch. Interrupted requests retain their uncertain cost; importing the same process history twice does not double count it.
- Completed runs return their saved summary without new proposals or artifact rewrites. New summaries include git commit, manifest hash, approved goal hash, and per-run usage.
- `MEMORY_EVAL_ID=<original-id>` resumes `scripts/memory-eval.ts` with the same positional arguments. Persisted pairs, including excluded incomplete pairs, are skipped. A missing comparison replay is rebuilt from the persisted pair without provider access. `results.json` includes git commit and manifest hash.
- `approvedDoD` is optional and is never recompiled during resume. Its goal must match `task.goal`. Custom contracts currently require `research:false` and `probes:0`, since those helper evaluations still use the default contract. The C2 agent reviewed this guard.

## Verification

The patch was applied only in a separate fixture at:

`/var/folders/bx/7kz0m40d1fncls8k1b0smzcw0000gn/T/factory-c1-integration-zib55o8x`

On that patched fixture:

- `npm run typecheck`: passed.
- `npm test`: 62 passed, 0 failed, including the follow-up artifact-guard regression.
- `npm run build:static`: passed; 26 modules, eight recorded replay bundles.

Seven new checkpoint tests cover manifest mismatch, refusal of unbound existing artifacts, journal tampering, counter restoration, uncertain reservation restoration, completed-pair reuse, and a real SIGKILL/restart. The restart test compares champion, memory, research, replay, summary, events, and experiment artifacts against an uninterrupted run, normalizing only time fields. It verifies that exactly generations 2–4 execute after a generation-1 checkpoint, altered goal contracts refuse resume, and a completed rerun is a no-op. A second kill after reservation creation verifies that the request remains charged after restart. The memory-evaluation test runs twice with an empty API key and retains one unchanged pair row.

Ordinary exhausted provider failures remain recorded proposal attempts, so a terminal run containing those failures returns the cached result. A deliberate retry uses a new run ID. Thrown loop errors leave the run unfinished and resume from the previous committed generation. This preserves the existing failure-classification behavior without silently repeating paid work.

No paid API calls, commits, pushes, deployments, or new dependencies were made for C1. The pending action is applying this reviewed patch in the shared checkout, then rerunning the three commands above there.
