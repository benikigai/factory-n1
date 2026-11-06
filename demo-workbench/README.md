# Guided factory workbench

Runnable handoff of the local demo for integration into Claude's landing and replay design. Uses this repository's simulator, committed recordings and original Three.js station models.

## Run

Install the root repository dependencies first with `npm ci`. Then, from this directory:

```sh
npm ci
npm run dev
```

Open http://localhost:5180/?run=live-a-5. If that port is occupied, use `npm run dev -- --port 5183`.

Click **Guided demo · 6 min** for the 15-step walkthrough. It automatically loads the recorded `live-a-5` run. Next and Back restore each step's scenario, panels, station or agent selection, and playback. Speaking notes stay visible. Finish and Exit restore the clean factory view.

Other controls:

- Click stations for measured stats, supported packages, routing and failure evidence.
- Expand the demand panel for normal, peak and fragile previews using the original simulator. Previews do not alter saved run evidence or call models.
- Open Agent factories to inspect real roles, generations and tool receipts.
- Open Nemotron fine-tune results for the completed critic and optimizer experiments, with baselines, methods and limitations.
- The title links to the landing page at localhost:5181, matching the original local demo setup. Update that URL when integrating into a shared origin.

## Verify

```sh
npm test
npm run build
```

See `HANDOFF.md` for the integration map and `DEMO-SCRIPT.md` for the manual presentation route.

## Limits

The guided script is deliberately bound to `live-a-5`, whose recorded numbers it quotes. The fine-tuned adapters are separate completed experiments and are not connected to the replay or live-agent control. New paid jobs require server-side credentials and explicit per-run consent. No credentials or private runs are included here.

A production static build shows the UI but needs the local API to load the workbench. The existing repository's `web/` viewer has a different static-recording loader; preserve that loader when porting the presentation components.
