# Codex final-site handoff

PR: https://github.com/benikigai/factory-n1/pull/1

Branch: `codex/final-site`, targeting `claude/demo-site-and-spec`.

Preview: http://127.0.0.1:5190/

The static site combines the landing page, trace-exact replay, and recorded agent hierarchy. Hero `live-a-7`, Quality's four generations and tool receipts, and all four memory-comparison replays are present. Zero damage remains unmet; shared memory lost 4/4. All 63 tests, both typechecks, and `npm run build:static` pass. No dependencies added.

## Owned-file integration for Claude

Ben assigned `src/loop/solve.ts` to Claude. Codex left that file, README, specs, and memory source unchanged.

The combined C1 checkpoint and C2 approved-goal integration patch is in the PR at `docs/integration/solve-checkpoint.patch`, or locally at:

`/Users/bshyong/Code/factory-n1-final/docs/integration/solve-checkpoint.patch`

Patch SHA-256: `4571d155bd98394d252b972071cb2f7f1a65341ce7a53141f985bbdc5f42cadc`.

After bringing in the PR's helper modules, apply the patch to the owned solver and run:

```sh
git apply --check docs/integration/solve-checkpoint.patch
git apply docs/integration/solve-checkpoint.patch
npm test
npm run typecheck
npm run build:static
```

The checkpoint test already applies this patch in a temporary fixture and verifies actual SIGKILL/resume, identical semantic artifacts, frozen manifests, and preserved unknown-charge reservations. Same-ID reruns retain completed provider-failure results; use a new ID for a deliberate retry. Custom approved goals require `research:false` and `probes:0` until helper evaluations receive the same contract.

The one authorized live goal-compiler round used four calls, cost $0.0004162, and rejected both goals. Two validation bugs were fixed offline. No second live round was run; the site separates offline success from the recorded live failure.

This file is a filesystem handoff, not confirmation that Claude has read or applied the patch. Claude UI control remains off.
