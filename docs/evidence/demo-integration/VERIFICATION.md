# Run 11 guided demo integration

Verified locally on October 17, 2026. Base: origin/main at cbd6e28. Work branch: codex/run11-guided-demo. Claude's floor geometry, scene renderer, visual system, recorded data, simulator and live-run backend were preserved.

## Delivered

- Run 11 is the presentation default. Two timed tours have Next, Back, Pause/Resume timer, Exit, speaking notes and automatic scene/panel selection: 4 stops over 60 seconds, or 8 stops over 240 seconds. The short script is 104 words and the judges script is 425 words. Every stop stays at or below 120 spoken words per minute. Starting it from run 5 switches to run 11.
- Station inspectors explain operation, size/zone eligibility, queue metrics and trace-derived routing/failures. Normal, peak and fragile previews run the existing simulator locally and preserve recorded evidence.
- Completed critic and optimizer pilot results are in one collapsible panel with separate experiment sections, explicit comparison definitions, limitations and source links.
- Landing and replay copy distinguish validation feedback from an untouched final test. The 82% claim is a simulator-penalty reduction; run 11 continued from run 7.
- Operator controls stay collapsed and are absent in static builds. The existing live-run and visual-inspection endpoints are retained.
- Phone layouts hide crowded scene labels. A station selector and child-agent list retain access to every node.
- Vite uses polling because this filesystem did not reliably deliver file-change notifications. After restarting once with the new configuration, a CSS edit and its removal were served without another restart.

## Checks performed

| Check | Result |
| --- | --- |
| npm test | 112 passed, zero failed |
| npm run typecheck | Passed |
| npx tsc -p tsconfig.web.json --noEmit | Passed, includes the previously unchecked viewer |
| npm run build:static | Passed, including the existing check that paid/local API code is absent from static output |
| git diff --check | Passed |
| Landing → Demo → brand link back to landing | Passed in the production build served by a plain HTTP server |
| Timed tours | Four 15-second stops and eight 30-second stops; all boundaries and total durations covered by tests |
| Judges tour navigation | All 8 stops, Back, Pause and Exit passed in the browser |
| Real-time short rehearsal | Auto-advanced through four 15-second stops and stopped at 1:00 / 1:00 with the result visible |
| Judges timer endpoint | Jumped to 3:30, resumed, and automatically stopped at 4:00 / 4:00 with the optimizer evidence visible |
| Back through all steps, Exit, Finish | Passed; restores controls and a clean recorded view |
| Start tour from another run | Switched run 5 to run 11 |
| Station selection | Baseline pack-1 and champion pack-B; stats, operation and route disclosures passed |
| Mobile station selector | Selected champion pack-B at 390px, with all stations available |
| Child agents | Designers → Route designer → Generation 1 → simulate_layout; recorded receipt chatcmpl-tool-979cac7e9d03a596 |
| Visual inspector | Existing recorded report opened; evidence image loaded |
| Evidence download | Valid JSON for live-a-11, champion shipped 100 with zero damaged |
| Phone layout at 390 × 844 | Comparison table and timer controls checked; no horizontal page overflow |
| Fresh browser console | No error-level messages during the final development journey |
| Local backend status | API responds; configured=false, running=false |

## Source checks

The recorded peak-202 scenario contains baseline makespan 1,581 seconds, 16 mis-sorts and 14 damaged; champion 1,184 seconds, zero mis-sorts and zero damaged. Both ship 100 packages. Mean validation objective is 18,061.11 → 3,283.44. The accepted run-11 move is pack-B (0,4) → (3,5), shortening the sorter leg from 15 cells to 11. No final split is recorded for this run.

The critic's 0/100 → 100/100 result describes response format, not reliable outcome prediction. The separate optimizer pilot compares 20 unseen factories with three proposal opportunities per method. Its reductions from the initial mean objective are base 0.14%, tuned 12.64%, random legal moves 4.27%. These are completed pilot results, not live calls or the run-11 optimizer.

## Local handoff

Run `npm run web -- --host 127.0.0.1 --port 5184 --strictPort` in this checkout. The landing is `/`; the presentation is `/replay.html?run=live-a-11`. The same relative links work in the production build. The scripts are in `docs/DEMO-SCRIPT.md` and derive from `web/demo-tour.ts`. Timed tours auto-advance; Pause timer holds the current stop. Manual Next/Back jump to the scheduled beginning of a stop. On completion, the last evidence remains visible until Finish.

This is locally verified and has not been merged or publicly deployed. No paid model calls, paid inspections, training jobs or final-split evaluations were run. Live launches require the existing 1Password-backed `FACTORY_ENV_FILE` mount; no credentials were copied. The static export plays all recorded evidence without a backend. This is not a full accessibility audit.

## Local-only presenter controls

The one-minute and four-minute tours now load only in Vite development mode. Production builds exclude their buttons, timer UI and narration code. The build guard rejects presenter-control text if it leaks into a future public bundle. Local browser verification found both controls and exercised the short tour; the production preview had zero presenter buttons and zero coach panels, while the factory view and optimizer comparison remained available. All 113 tests and the production build passed. This change has not been deployed to Vercel.
