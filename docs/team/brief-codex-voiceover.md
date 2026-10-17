# Brief for Codex: 60-second voiceover in Ben's ElevenLabs voice

From the quick-fixes session, 2026-10-17. Ben approved this script. Render it with Ben's ElevenLabs voice; Screen Studio cuts the screen to these clips.

## Rules

- Use Ben's own ElevenLabs voice only. No other voice, no voice changes between clips.
- Read the text exactly as written below. It is already spelled for speech ("N plus one", "You dot com"). Do not add, drop or reword lines.
- Check ElevenLabs credit use with Ben before generating more than one full pass plus small retakes.
- Save audio outside git: `runs/voiceover/` (gitignored). Do not commit audio files.

## Clips (one file per beat)

| File | Target length | Text to speak |
|---|---|---|
| `01-hook` | ≤ 8.0 s | Factory N plus one is a simulated warehouse that redesigns itself. Factory N plus one ships only if it beats Factory N. |
| `02-result` | ≤ 8.0 s | On its busiest day, the first version broke fourteen packages. Version eleven broke none. |
| `03-team` | ≤ 11.0 s | The redesigning is done by AI agents: NVIDIA's Nemotron models on Crusoe's cloud, using You dot com to research real warehouse layouts. |
| `04-simulator` | ≤ 10.0 s | Every idea is tested in a simulator the AI can't change, and it only stays if it wins on days the AI never practiced on. |
| `05-ruler` | ≤ 11.0 s | The agents kept misjudging distances, so we gave them a measuring tool. On the next run, they moved one packing station three squares, and the floor cleared six minutes faster. |
| `06-proof` | ≤ 7.0 s | That run cost four cents. When one model faked a test, the simulator caught it. |
| `07-close` | ≤ 5.0 s | That's Factory N plus one: every version has to beat the last. |

Total must be 60.0 s or less. If a clip runs long, lower the pause lengths or raise the speaking speed slightly for that clip. Do not cut words.

## Delivery

- Plain, conversational, like explaining to a friend. No announcer tone, no dramatic pauses.
- Slight stress on "beats" in clip 01 and on "none" in clip 02.
- Pronunciation: "Nemotron" NEM-oh-tron · "Crusoe" CROO-so · "N plus one" said as three words.

## Output and check

1. Write `runs/voiceover/01-hook.mp3` through `07-close.mp3`, plus `runs/voiceover/full-60s.mp3` with the clips joined and 0.3 s of silence between them.
2. Write `runs/voiceover/durations.json` with each clip's measured length and the total.
3. Listen once to the full track for mispronunciations ("N plus one", "Nemotron", "You dot com"). Fix only the clip that is wrong.
4. Report to Ben: the folder path, each clip length, total length, and the ElevenLabs credits used.

## Screen timing (for Screen Studio)

| Clip | Screen at localhost:5173 | Caption |
|---|---|---|
| 01 | `/?speed=60` hero, both floors running | FACTORY N+1 · ships only if it beats Factory N |
| 02 | Same hero, zoom from the left floor to the right one | Version 0: 14 broken → Version 11: 0 broken |
| 03 | `/#bom` Packing slip, then the LIVE run tab (Run live → Continue from run 7) | NVIDIA Nemotron · Crusoe · You.com |
| 04 | `/#process` Route strip, ending on Simulate and Gate | Kept only if it wins on unseen days |
| 05 | `/#revisions`, from Rev 8–10 HOLD to Rev 11 APPROVED | One station moved · 6 min faster |
| 06 | `/#top` title block, then `/#inspection` | 4¢ · faked test caught |
| 07 | `/#top`, full hero | FACTORY N+1 |

## Facts behind the lines (do not change these)

- "Version eleven broke none": run 11 had 0 damaged on the peak day and on all 15 development days. The final test days stay locked.
- "Six minutes faster": 26:21 down to 19:44 on the peak day.
- "Four cents": run 11 cost $0.042.
- "Faked a test": in the first live call, a model described a simulator re-run that never happened; the frozen grader measured otherwise.
