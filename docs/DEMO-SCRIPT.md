# Factory N+1 timed judge demos

Open `/replay.html?run=live-a-11`. Choose **1-minute demo** or **4-minute judges demo**. Both use the recorded run, automatically advance, and make no paid calls. The timer begins after run 11 loads.

Pause timer while answering a question. Next and Back jump to the start of a stop. The final result or evidence panel remains visible when the time ends; Finish returns to the clean factory.

## 1-minute demo

4 stops · 60 seconds · 104 spoken words.

### 0:00–0:15: The factory

On screen: Show the two factories. Packages are moving through the recorded run.

> Factory N+1 simulates receiving, sorting, packing and shipping. The left floor is the baseline; the right is the agents’ improved design. Both replay the same packages.

### 0:15–0:30: Agents improve the design

On screen: The child-agent factory opens. Point to the three designers.

> Specialist agents propose changes. The simulator scores them, and code accepts improvements. Results feed the next round. Click these child factories to inspect the recorded work.

### 0:30–0:45: One measurable fix

On screen: Point to the 11-cell inbound route at pack-B.

> Run eleven continued earlier work. Moving pack-B shortened its inbound trip from fifteen cells to eleven, below the damage threshold. Code verified the change.

### 0:45–1:00: The result

On screen: Show the final checks. Leave this result on screen at the end.

> One hundred packages shipped in nineteen minutes, forty-four seconds, with zero mis-sorts or damage. Penalty fell eighty-two percent across nine feedback validation days, not an untouched final test.

## 4-minute judges demo

8 stops · 240 seconds · 425 spoken words.

### 0:00–0:30: Meet the factory

On screen: Introduce the baseline on the left and run 11 on the right.

> Factory N+1 is a simulated fulfillment center that agents can redesign. Packages arrive at receiving, pass through sorting and packing, then leave through the correct shipping dock. Each station processes one package at a time, so layout, capacity and queues affect performance.

> Both factories replay the same packages on the same clock.

### 0:30–1:00: Explain the failures

On screen: The sorting and damage rules are open.

> Our baseline packing stations accept small and medium boxes, leaving large boxes without an eligible station. The sorter uses a fallback and records a mis-sort.

> Damage is separate: a fragile package gets damaged if any one trip exceeds twelve grid cells. Exactly twelve is safe. These are reproducible simulator rules, not physical damage predictions.

### 1:00–1:30: Stress the same layout

On screen: Peak demand is selected. Point to the Normal, Peak and Fragile options.

> Normal demand spreads one hundred arrivals across twenty minutes. Peak compresses them into five minutes, stressing queues. Fragile demand raises the fragile probability from ten to thirty-five percent, exposing long routes.

> These controls test the saved layouts with the real simulator and fixed seeds. They make no new model calls.

### 1:30–2:00: Open the agent factory

On screen: Designers → Route designer → Generation 1. The recorded proposal and child tools are visible.

> Researchers suggest ideas, designers propose layouts, and the simulator scores them. Code accepts at most one improvement per generation and passes results into the next round.

> Here is the recorded route proposal, with child tool receipts you can inspect. The current system uses fixed roles; it does not invent arbitrary new agents.

### 2:00–2:30: Trace the accepted fix

On screen: Champion pack-B is selected. Its inbound route is 11 cells.

> Run 11 continued from run 7. Its accepted edit moved pack-B from zero, four to three, five. That shortened the sorter trip from fifteen cells to eleven. The next trip to the shipping dock is eight cells.

> Both are below the damage threshold. This receipt explains a specific improvement instead of asking you to trust the model.

### 2:30–3:00: Read the measured result

On screen: Compare the final goal checks, then the validation score.

> The baseline ships all one hundred packages in twenty-six minutes, twenty-one seconds, with sixteen mis-sorts and fourteen damaged packages. Run 11 finishes in nineteen minutes, forty-four seconds, with neither error.

> Simulator penalty fell eighty-two percent across nine feedback validation days. That includes earlier work. This is not an equal-budget comparison or an untouched final test.

### 3:00–3:30: Fine-tune one: the critic

On screen: The separate critic experiment and its limitations are open.

> Separately, we trained two small adapters on the same Nemotron Nano eight-billion-parameter model. The critic learned the required response format: zero out of one hundred valid responses became one hundred.

> It did not become a reliable judge. It recognized none of seventeen goal-passing layouts. We proved format learning, so the simulator still decides.

### 3:30–4:00: Fine-tune two: the optimizer

On screen: Compare all three methods. Finish leaves the factory clean and paused.

> The optimizer learned from twelve hundred simulator examples. On twenty unseen factories, penalty fell twelve-point-six-four percent with the adapter, versus zero-point-one-four for the base model and four-point-two-seven for random legal moves.

> This separate pilot still had twenty-one invalid moves out of sixty, and no full-goal successes. Neither adapter powers this replay yet.
