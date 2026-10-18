# Optimizer comparison

Local side-by-side 3D replay of the retained base and fine-tuned layouts from the completed 20-factory evaluation. Both columns animate identical packages on the same demand day. The top scores average four held-out days; the sidebar shows the selected day's measured results. All factories, including losses and ties, are selectable.

Build and serve separately from the frozen demo:

```sh
test -f runs/optimizer-viewer/data/catalog.json || npx tsx scripts/build-optimizer-replay.ts
npx tsc --noEmit -p optimizer-viewer/tsconfig.json
npx vite build --config optimizer-viewer/vite.config.ts
python3 -m http.server 5192 --bind 127.0.0.1 --directory runs/optimizer-viewer-dist
```

Open http://127.0.0.1:5192/. The default is factory 12, the upper-middle case after ranking all 20 by paired percentage improvement. Each exported trace must reproduce its saved metrics with the unchanged simulator. The exporter reads the local evaluation and dataset under `runs/`; it makes no model calls.

The generated static site is in `runs/optimizer-viewer-dist`, so this command does not rebuild or overwrite `web/dist`. It has no live inference endpoint. The experiment did not reach zero damage or the full goal. See `docs/evidence/nemotron-optimizer-pilot.md` for results and limitations.
