# Integration handoff for Claude

## Scope

This directory is the working demo from localhost:5180, packaged against the repository root instead of a sibling checkout. No files under `web/`, simulator source, or committed recordings were modified. This branch adds the handoff directory only. The design reskin was paused at Ben's request so Claude can incorporate these features into the new design.

No new npm dependencies were added. Credentials, `.factory.local.json`, local runs, old Kenney assets and generated build output are excluded.

## Features to preserve

| Feature | Source | Integration note |
| --- | --- | --- |
| 15-step judge walkthrough | `src/demo-tour.ts` | Step definitions contain narration and declarative targets. `DEMO_RUN` is `live-a-5`; quoted metrics must stay bound to that recording. |
| Next/Back/Exit orchestration | `src/main.ts`: `renderDemo`, `showDemoStep`, `startGuidedDemo`, `stopGuidedDemo` | Calls application state functions directly. Do not replace with synthetic DOM clicks. Keep deterministic Back behavior, panel reset, run selector lock and the no-paid-calls boundary. |
| Presenter panel | `src/main.ts`, `src/style.css` | Fixed notes with scrollable text and persistent controls. Responsive sizing and focus target scrolling account for the sticky run controls. |
| Station explanations and failure attribution | `src/factory-guide.ts` and `renderInspection` | Uses simulator constants and actual trace legs. Distinguishes already-damaged arrivals from the trip that first caused damage. Exactly 12 cells is safe; more than 12 damages fragile packages. |
| Demand previews | `previewDemand` and `selectDemand` | Uses the original simulator on unchanged saved layouts. Keep previews labeled separately from recorded validation scores and agent evidence. |
| Fine-tune panels | `src/nemotron-results.ts` | Fixed completed experiment results, not the selected run's model metrics. Keep the critic's format-only conclusion and optimizer limitations. |
| Optimizer comparison explanation | `src/nemotron-results.ts` | Same 20 unseen starting buildings, three opportunities each, fresh demand scoring. Percentages reduce the initial aggregate mean objective, not throughput or base-relative improvement. |
| Compact station labels and selection | `src/claude/world/floor.ts` | Keep station model clicks, keyboard-selectable labels, compact default labels and hover stats. |
| Label placement and agent floors | `src/claude/world/warehouse.ts` | Preserves original geometry and scored coordinates. Agent floors only arrange existing records for navigation. |
| Live backend controls | `server/` and `vite.config.ts` | Existing original simulator and agent loop, bounded consent, one local worker. Keep Claude's newer loader, visual-inspection tools and live-run controls when integrating; this handoff does not replace those. |

## Paths when moving into web/

- This package's `src/factory-guide.ts` becomes `web/factory-guide.ts`: change `../../src/` simulator imports to `../src/`.
- Its `src/nemotron-results.ts` imports `../../web/ui/dom`; inside `web/` use `./ui/dom`.
- Its `src/demo-tour.ts` imports the sibling factory guide and runtime; keep those relative relationships.
- Presentation code in `src/main.ts` corresponds to `web/main.ts`, but the loaders differ. Port the relevant functions and panels; do not overwrite `web/main.ts` wholesale.
- Its floor and warehouse files have local `../../runtime` references and root-relative imports. Use the target viewer's existing paths when porting.

## Acceptance checks

1. Start guided mode from a different selected run. Confirm it loads `live-a-5` and shows the recorded badge.
2. Walk all 15 steps forward. Check the three profiles, completed metrics, champion pack-1's four damaged inbound packages, and the actual `simulate_layout` receipt.
3. Walk backward. Every step must restore its panels and selected station/agent, with no stale scenario.
4. Confirm the optimizer table reads 0.14%, 12.64%, 4.27% and explains the common starting baseline.
5. Finish and Exit must hide the notes, unlock run selection and restore the factory view.
6. At 390px, Next and Back remain on screen and notes scroll without horizontal overflow.
7. Preserve the landing-page link, visual-inspection features and latest source design.

This packaged branch passed all 10 tests and the production build. A browser run on port 5183 completed all 15 guided steps, Finish, and the champion pack-1 inspector (19 processed, 64.0% utilization, four damaged arrivals). The original local demo also passed the full backward walkthrough and mobile checks before packaging. Re-run checks after integrating with the design.
