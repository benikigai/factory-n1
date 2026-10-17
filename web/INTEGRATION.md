# Static frontend integration

The replay combines the original Factory N+1 scored-trace renderer with the clickable agent hierarchy from `recursive-factory`, inspected October 17, 2026. The landing uses Argon's cream-and-forest layout and five-stage story, with facts from the committed live-a-7 recording.

All browser imports and run artifacts are local to this repository. `npm run build:static` creates `web/dist` for a static HTTP host. No backend, credential mount, or model call is needed. The build copies committed recordings and public evidence, then writes the asset manifests used by the viewer.

## Routes

- `/`: live-a-7 proof board, recorded trace preview, comparisons, memory study, source evidence, and separate offline/live goal compiler receipts.
- `/?speed=60`: the same landing page with a 60x hero replay for video capture. Station labels stay hidden in the small hero; the full replay retains them.
- `/replay.html?run=live-a-7`: exact baseline/champion trace replay, controls, station inspection and run evidence.
- `/replay.html?run=live-a-7&view=agents`: recorded role hierarchy.
- `/replay.html?run=live-a-7&view=agents&node=g1-quality`: accepted Quality proposal and clickable tool receipts.
- `/replay.html?run=memeval-2026-10-17T19-41-04-350Z-factory-{f,g}-r{1,2}`: the four paired memory comparisons, including final-split results.
- `/runs/index.json` and `/evidence/index.json`: build manifests.

The agent floor is a navigational arrangement of recorded roles, proposals, and receipts. Its presentation coordinates are never simulator inputs. Designer roles derive from experiments rather than a fixed list. Comparison artifacts without an agent event stream do not invent agent roles.

## Checks

```sh
npx tsc --noEmit -p web/tsconfig.json
npx tsx --test test/web-snapshot.test.ts test/web-state.test.ts
npm run build:static
python3 -m http.server 5191 --bind 127.0.0.1 --directory web/dist
```

Browser checks covered the landing at 1280 and 1440 pixels, the landing and workbench at 390 pixels, Quality and tool-receipt drill-down, deep links, run switching, final trace counters, and the failed live goal-compiler labels. No model calls were made by the site integration.

## Limits

The site replays committed recordings. It does not launch agents. live-a-7 has lower validation objective but still fails zero damage. Shared memory lost all four fresh-factory comparisons. The goal compiler's offline demonstration and failed live smoke test remain separately labeled.
