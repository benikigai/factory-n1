# Demo script

**Setup:** `npm run web` (or the static site), open the hero run `live-a-5`, 16× speed, overview camera. The badge must read **RECORDED**.

## 3-minute live demo

**0:00 Problem (20 s).** "Agent teams fill vague goals with assumptions and report success. Ours runs a fulfillment floor. Its goal is one line: ship 100 packages in 25 minutes, at most 1 mis-sort, nothing damaged. That goal is executable checks, not a vibe."

**0:20 The world (25 s).** Point at the two floors on one clock.
- "Left is the starting floor, right is what the agents built.
- Same 100 packages, same peak day, same playback speed.
- Every box is the exact trace the frozen simulator scored."

Then switch to close-up on the left floor's bottleneck.

**0:45 The loop (45 s).** Walk the rail.
- "Nemotron Lightning researched warehouse practice on You.com. Every citation has to match a returned URL exactly, and these external ideas stay labeled as untested hypotheses.
- Two Nemotron Super VL designers read the same shared memory. They test drafts against the simulator and submit through a typed tool.
- The simulator, not the model, decides. A change is kept only if it's at least 1% better on separate validation days."

Point at one rejected candidate and its reason.

**1:30 Honesty is the feature (40 s).**
- "Models over-claim. Lightning once invented a simulator re-run with fake numbers. So every proposal predicts its score and we grade it: blind designers had 4 of 7 claims refuted; designers that test their drafts had 0 of 7.
- Super VL credited a fix to the wrong edit, so code scores each edit alone. Those causal receipts are the only thing a lesson may cite.
- Citing a web hypothesis in a winning proposal doesn't promote it. Only its own isolated test can."

**2:10 Result (30 s).**
- Validation goes from 18,061 to 10,733, **−40.6%**.
- That beats the one-line code heuristic (13,194) and random search with the same 23 evaluations (13,092).
- On this peak day: makespan 1,581 → 729 s, mis-sorts 16 → 0.
- "Damage is still 13, so the goal check says FAIL, and we show it."

**2:40 What's next (20 s).** "Five factory layouts are ready to test whether the learned memory transfers to unseen factories. Every experiment is already logged as training data for a future Lightning fine-tune."

## Likely questions
- **Is it really learning?** Within a run, yes, measured by the gate. Transfer across factories hasn't been shown yet.
- **Why not a genetic algorithm?** At equal evaluation budget, random search lands at 13,092 vs our 10,733. With about 3,000 evaluations it does better, and it overfits.
- **What's real vs simulated?** The factory is a queueing simulation with synthetic rules. Model calls, searches, citations and scores are real and independently re-scored.

## 1-minute video beats
1. 0–8 s: the goal line, then both floors starting together.
2. 8–25 s: packages flowing; the left floor's queue builds; the right floor clears.
3. 25–40 s: rail: research citation, rejected candidate with reason, accepted change with receipts.
4. 40–52 s: before/after: −40.6% vs heuristic and equal-budget random search.
5. 52–60 s: "DoD still FAIL: damage remains. Every number re-scored independently."
