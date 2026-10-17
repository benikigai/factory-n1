# Optimizer v2 comparison

Separate local viewer for a completed v2 evaluation. Select any pair of the four model arms and compare their retained layouts after 3 or 12 proposals. Every scene uses the same final-day packages and one clock. Scores aggregate four final days; random moves and the privileged geometric planner are labeled separately.

After the evaluation and independent audit finish:

```sh
npx tsx scripts/build-optimizer-v2-replay.ts --evaluation runs/optimizer-eval/COMPLETED-RUN
npx tsc --noEmit -p optimizer-v2-viewer/tsconfig.json
npx vite build --config optimizer-v2-viewer/vite.config.ts
npx vite preview --config optimizer-v2-viewer/vite.config.ts
```

Preview: http://127.0.0.1:5193. Output: `runs/optimizer-v2-viewer-dist`. Neither the existing optimizer viewer nor the frozen demo is modified.

The exporter refuses incomplete evaluations before reading sealed factories, re-scores all saved snapshots, checks per-day metrics, and retains all twenty factories. Synthetic fixture tests run with `npx tsx --test optimizer-v2-viewer/replay.test.ts` and never read sealed test data.

For an independently audited 19-factory continuation, add `--mode continuation` and point `--evaluation` at the continuation root. This reads `continuation-results.json` and verifies the manifest's nineteen included IDs plus the one excluded interrupted factory. A permanent banner discloses the original twenty-factory scope, exclusion, examined partial results and unresolved request. All headline rates use nineteen. The internal `engine/metrics.json` is refused in ordinary mode and is never presented as a completed twenty-factory comparison.

This is a small synthetic benchmark. More accepted moves or a lower objective alone does not establish zero damage or full-goal completion. The geometric reference has extra rule knowledge and planning computation.
