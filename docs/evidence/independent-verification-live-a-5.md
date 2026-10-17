> Independent verification performed by Codex at Ben's request on 2026-10-17, copied here verbatim from its local report. Paths refer to the verifier's machine; the run data is in `recorded/live-a-5/` (public copy, search excerpts removed).

# Independent end-to-end verification

Verified October 17, 2026, on the local MacBook Pro. Final inspected run: `live-a-5`.

Demo: http://127.0.0.1:5173/?run=live-a-5

## Passes

- `npm test`: 28 tests pass, including invalid/non-improving proposals, citation-only non-promotion, isolated-test promotion, trace interpolation and final playback counters.
- `npm run typecheck` and `npm run web:build`: pass.
- Two real You.com searches produce exact source URLs, excerpts, query, retrieval time and tool receipt IDs that persist into shared memory.
- The run used 36 real model requests. Later generations consumed memory versions 4, 10, 13 and 19. One candidate was accepted and seven rejected; stalled generations triggered targeted research.
- The corrected memory distinguishes citations, untested hypotheses, isolated interventions and observations from accepted experiments. No untested external hypothesis in this run is marked verified.
- Independently re-scored all recorded candidates with measured results. Baseline/champion train and validation scores match saved values.
- Independently regenerated the baseline and champion replay from the saved layouts and scenario seed. All package traces and metrics match exactly, using grader hash `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`.
- Browser: real 3D meshes visible; common clock/camera; pause/resume, 60x speed, scrub to end and back, overview and bottleneck close-up work. Final counters agree with the simulator. A missing run displays an explicit 404 and does not substitute fabricated results.
- Browser changed from LIVE to RECORDED when the run completed. Development/validation labels and conservative evidence labels are visible.

## Measured result

Validation objective: 18,061.11 -> 10,733.22, a 40.57% reduction.

On the identical replay scenario `peak-202`: 100/100 shipped for both layouts; makespan 1,581 -> 729 seconds; mis-sorts 16 -> 0; damaged packages 14 -> 13.

Run cost from returned usage: $0.01530656 inference plus $0.01 estimated search cost. This is the run's usage estimate, not an account billing receipt.

## Limits

- The full Definition of Done still fails because packages remain damaged. The application displays FAIL.
- This proves working integration and a better layout on development/validation scenarios. Most gains occur in generation 1; later generations stalled. It does not establish that shared memory improves solver performance on fresh tasks or against a no-memory ablation.
- Final evaluation seeds were not unlocked by this verification.
- Older runs retain their original memory artifacts; their unsupported labels are now shown as legacy labels rather than being rewritten as new evidence.
- The local development server needed a restart to pick up source changes; the final browser check used the restarted server.

Machine-readable rescore results: `replay-audit.json` in this directory. Training/experiment data remains in the run folders. No fine-tuning was run.
