# Factory N+1 walkthrough scripts (Ben's voice)

Spoken scripts for the replay. Numbers are checked against the recorded runs. The lines in brackets are what to point at.

## 1 minute (about 140 words)

**0:00 Hook** [both floors at 60x]
A factory that redesigns itself.
Left is the original floor. Right is what Nemotron agents built. Same 100 packages. Same clock.

**0:12 The loop** [Agent factories]
Nemotron Lightning researches on You.com. Nemotron Super VL designers propose new floors. All of it runs on Crusoe.
The agents never grade themselves. A frozen simulator does. A change ships only if it beats the last version on 9 days the designers never saw.

**0:30 The fix** [rail: Generation 1, the pack-B edit]
Run 7 cut the score by two-thirds. One 15-cell conveyor still broke fragile packages.
Run 11 moved one pack station 3 cells inland. 15 cells became 11. Under the limit.

**0:45 Result** [goal checks]
100 of 100 shipped. 19:44. Zero mis-sorts. Zero damage.
82% better. 4 cents.
Version N+1 has to earn it.

## 4 minutes (about 560 words)

**0:00 The problem** [landing hero]
A factory floor gets drawn once.
Then demand shifts. Products change. Peak days hit. The floor stays.
Agents can propose the redesign. But agents grade their own homework. One of ours invented a simulator run that never happened.
So we flipped it. The agents draw. Code decides.

**0:30 The floor** [both floors at 60x]
This is a simulated fulfillment center. 24 by 14 cells. Receive, sort, pack, ship.
Left is the original floor. Right is the agents' floor. Same 100 packages, same clock.
The goal is four checks written as code. Every package ships. Under 25 minutes. At most one mis-sort. Nothing damaged.

**1:00 Why the old floor fails** [baseline pack stations]
Two rules.
The old pack stations only take small and medium boxes. Large boxes have nowhere to go, so they get mis-sorted.
Fragile packages break on any conveyor leg longer than 12 cells.
On the peak day the old floor takes 26:21. 16 mis-sorts. 14 damaged.

**1:30 Stress tests** [scenario switch]
Every layout runs on three kinds of day.
Normal spreads 100 arrivals over 20 minutes. Peak crams them into 5. Fragile raises fragile packages from 10% to 35%.
Fixed seeds. Same days for every design. No model calls.

**2:00 The agent factory** [Agent factories, then Designers]
The team is a factory too.
Two models do the creative work. Nemotron Lightning researches on You.com, and every citation has to match a URL the search returned. Three Nemotron Super VL designers propose layouts through typed tool calls and test drafts first.
Three pieces of code keep them honest. The evaluator scores. Memory keeps only what was measured. The supervisor decides when it's done.
At most one change ships per generation.

**2:30 The fix** [rail: the pack-B edit and its receipt]
Run 7 gave each zone its own pack station. 66% better. But one leg, sorter to pack-B, was 15 cells. Fragile packages kept breaking.
Runs 8 to 10 stalled. The designers misjudged route lengths. We gave them a ruler tool.
Run 11 picked up run 7's floor and moved pack-B from (0,4) to (3,5). 15 cells became 11. The next leg to the dock is 8. Both under the limit.

**3:00 Result** [goal checks, then score]
Peak day: 19:44. Zero mis-sorts. Zero damage.
82% better across 9 held-out days. 54 model calls. 4 cents.
Run 7 is the fair comparison. With the same 41 simulator runs, it beat a one-line code fix and random search.

**3:30 Fine-tuning Nemotron** [Nemotron results]
We also fine-tuned Nemotron Nano 8B on a Crusoe GPU. Two experiments.
The critic learned our format. Valid answers went from 0 to 100 out of 100. It couldn't predict outcomes. The simulator stays the judge.
The optimizer trained on 1,200 simulator examples. On 20 factories it never saw, it cut the score 12.6%. The base model managed 0.1%. Random moves, 4.3%.
Still no full-goal wins, and 21 of 60 moves were invalid. That's the next version.

**3:50 Close** [landing: What's next]
Today the nodes are stations. Next they're humanoid robots, vision models and world models. The gate stays the same.
The floor is never finished. It ships its next revision.
