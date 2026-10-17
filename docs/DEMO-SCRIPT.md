# Factory N+1 judge walkthrough

Open /replay.html?run=live-a-11 and click **Guided demo · Run 11**. Allow about six minutes. Next and Back restore the relevant scene and panel; Exit returns to the recorded factory, paused at the end.

## 1. Meet the factory

On screen: Point to receiving, sorting, packing and shipping. The recorded replay is playing.

> This is Factory N+1. We built a simulated fulfillment center where agents redesign the operation and test their changes.

> Packages arrive at receiving, pass through sorting, get packed, and leave through the correct shipping dock. Each station handles one package at a time, so placement, capacity and queues affect the result.

## 2. Why the starting layout struggles

On screen: The left baseline’s pack-1 is selected. Point to Sizes: S, M.

> Our starting packing stations only support small and medium packages. Large packages have no eligible packing station.

> The sorter checks size and destination, then chooses the shortest queue. If no station qualifies, it uses a fallback and records a mis-sort.

## 3. How damage happens

On screen: The simulation rules are open. Red means damaged; an amber flash means mis-sorted.

> Damage follows a separate rule. A fragile package gets damaged when any single trip exceeds 12 grid cells. Exactly 12 is safe.

> These are explicit simulator rules we can reproduce. They are not physical collision or damage predictions.

## 4. Normal demand

On screen: The same saved layouts are simulated under normal demand.

> Normal demand spreads 100 arrivals across 20 minutes, with a 10 percent fragile probability.

> The actual package mix comes from a fixed random seed, so we can replay the same test.

## 5. Peak demand

On screen: The peak preview is playing. Notice the receiving queues.

> Peak compresses 100 arrivals into five minutes, which stresses the queues. The fragile probability stays at 10 percent.

## 6. Fragile demand

On screen: This preview has a higher proportion of fragile packages.

> Fragile demand raises the fragile probability to 35 percent. This exposes long routes.

> These previews test the same saved layouts with different seeded demand samples. They require no new model calls.

## 7. What run 11 achieved

On screen: The original recorded peak-202 day is back at the end. Compare the final measured results.

> The starting floor shipped all 100 packages, but took 26 minutes and 21 seconds, with 16 mis-sorts and 14 damaged packages.

> Run 11 ships all 100 in 19 minutes and 44 seconds, with zero mis-sorts and zero damage on this displayed peak day. It meets all four checks.

> The 82 percent reduction is in the combined simulator penalty across nine validation days. Those days guided acceptance; they are not an untouched final test.

## 8. Trace the fix to one station

On screen: Champion pack-B is selected. Its inbound sorting route is now 11 cells.

> Run 11 continued from run 7. Its accepted edit moved pack-B from grid position zero, four to three, five.

> That shortened the sorter-to-pack-B trip from 15 cells to 11, below the damage threshold. The trip from pack-B to the B shipping dock is eight cells.

> The receipt isolates the change. The total 82 percent improvement includes the earlier work; it is not all caused by this one edit, and run 11 is not an equal-budget comparison.

## 9. Inside the agent factory

On screen: The agent view shows the recorded roles. You can still click to explore.

> Researchers suggest ideas. Designers propose layouts. The simulator scores them.

> The controller accepts changes that pass its checks, then feeds results and saved lessons into the next round. That is the recursive loop in this prototype: propose, test, learn, repeat.

## 10. Inspect an actual tool call

On screen: Opened Designers → Route designer → Generation 1 → simulate_layout.

> This is the simulator receipt behind the accepted route proposal. These nested views expose real execution records.

> The current backend uses fixed roles. It does not create arbitrary new agents at runtime.

## 11. Why the loop keeps some changes

On screen: The generation timeline shows the accepted route edit and rejected alternatives.

> Three designers propose different changes. Code scores them and keeps at most one per generation, only if validation improves enough and no goal check gets worse.

> The later rejected proposals remain visible. The agents cannot approve their own claims. No untouched final-split result is recorded for this run.

## 12. Critic: what the fine-tune proved

On screen: The completed experiment results are open. Point to 0/100 → 100/100.

> Separately, we trained two specialist adapters on the same Nemotron Nano 8B base model. An adapter changes a small fraction of the model’s parameters for a specific job.

> The critic was trained to predict factory outcomes. Its response format improved from zero out of 100 valid responses to 100 out of 100. We proved format learning.

## 13. Critic: what it did not prove

On screen: The critic’s held-out test details are open.

> Useful outcome prediction was not demonstrated. The critic recognized none of the 17 goal-passing layouts.

> Its zero-damage predictions were correct on 18 of 75 valid layouts. A simple majority prediction got 41 correct. So the simulator remains the judge.

## 14. Optimizer: the controlled comparison

On screen: Compare the three methods on the same 20 unseen starting factories.

> The optimizer learned from 1,200 examples of layouts, actions and simulator results. We tested it on 20 unseen factories, with three proposal opportunities per method per factory.

> The tuned model reduced the average penalty score by 12.64 percent from the starting layouts. The base model reduced it by 0.14 percent. Random legal moves reduced it by 4.27 percent.

> That score combines completion time, errors, damage and equipment cost. These percentages are reductions from the starting layouts, not improvements over the base model.

## 15. Optimizer: the evidence and limits

On screen: The optimizer test details show fresh demand scoring and the win/loss count.

> Final scoring used fresh demand days. Against the base model, the tuned optimizer won on 12 factories, lost on two and tied on six.

> It still proposed 21 invalid moves out of 60. None of the 20 factories achieved zero damage or the full goal.

> Training produced more useful station moves in this synthetic test. It did not solve the factory problem.

## 16. Close on the factory

On screen: The original factory is back on screen. Finish leaves the demo clean and paused.

> The training experiments are separate from this factory replay. The adapters are not connected to this UI yet.

> Run 11 demonstrates the agent improvement loop and a goal-passing simulated factory. The separate optimizer pilot shows a measured training gain. Every proposed improvement still has to survive the simulator.
