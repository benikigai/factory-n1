# Factory N+1 walkthroughs

The local app offers a 1-minute overview and a 4-minute detailed walkthrough of recorded run 11. Each advances automatically and supports Pause, Next and Back. The walkthrough controls remain excluded from production builds.

## 1-minute walkthrough

### 0:00 to 0:15: The factory

The same packages, two factory layouts.

Factory N+1 simulates receiving, sorting, packing and shipping. The baseline is on the left; the agents’ improved design is on the right. Both replay the same packages.

### 0:15 to 0:30: Agents improve the design

Specialist agents propose and test layout changes.

Specialist agents propose changes. The simulator scores them, and code accepts improvements. Results feed the next round. Each child factory contains recorded proposals and tool receipts.

### 0:30 to 0:45: One measurable fix

A shorter route keeps fragile packages below the damage threshold.

Run 11 continued earlier work. Moving pack-B shortened its inbound trip from 15 cells to 11, below the damage threshold. Code verified the change.

### 0:45 to 1:00: The result

Run 11 meets all four goals on the displayed peak day.

All 100 packages shipped in 19:44, with zero mis-sorts or damage. Simulator penalty fell 82% across nine feedback validation days. These are validation results, not an untouched final test.

## 4-minute detailed walkthrough

### 0:00 to 0:30: The factory

Baseline and improved layouts replay the same package flow.

Factory N+1 is a simulated fulfillment center that agents can redesign. Packages enter receiving, pass through sorting and packing, then leave through the correct shipping dock. Each station processes one package at a time. Layout, capacity and queues affect performance.

Both factories replay the same packages on the same clock.

### 0:30 to 1:00: How failures happen

Eligibility and travel distance determine failures.

The baseline packing stations accept small and medium boxes, leaving large boxes without an eligible station. The sorter uses a fallback and records a mis-sort.

Damage follows a separate rule: a fragile package is damaged if any trip exceeds 12 grid cells. Exactly 12 is safe. These are reproducible simulator rules, not physical damage predictions.

### 1:00 to 1:30: Stress the same layout

Normal, peak and fragile demand stress different parts of the factory.

Normal demand spreads 100 arrivals across 20 minutes. Peak compresses them into five minutes, stressing queues. Fragile demand raises the fragile probability from 10% to 35%, exposing long routes.

Each scenario tests the saved layouts with the simulator and fixed seeds. Scenario previews make no new model calls.

### 1:30 to 2:00: Inside the agent factory

Recorded proposals and tool receipts explain each decision.

Researchers suggest ideas, designers propose layouts, and the simulator scores them. Code accepts at most one improvement per generation and passes results into the next round.

The recorded route proposal includes child tool receipts. The current system uses fixed roles; it does not create arbitrary new agents.

### 2:00 to 2:30: Trace the accepted fix

The accepted pack-B move reduces its inbound trip to 11 cells.

Run 11 continued from run 7. Its accepted edit moved pack-B from (0,4) to (3,5), shortening the sorter trip from 15 cells to 11. The next trip to the shipping dock is eight cells.

Both trips are below the damage threshold. The simulator receipt connects the layout change to its measured effect.

### 2:30 to 3:00: Measured results

Measured outcomes for the displayed peak day and validation set.

The baseline ships all 100 packages in 26:21, with 16 mis-sorts and 14 damaged packages. Run 11 finishes in 19:44, with neither error.

Simulator penalty fell 82% across nine feedback validation days. That includes earlier work. This is not an equal-budget comparison or an untouched final test.

### 3:00 to 3:30: Fine-tune one: the critic

The critic learned the response format, not reliable outcome prediction.

Two separate adapters were trained on the same Nemotron Nano 8B model. The critic learned the required response format: valid responses increased from 0/100 to 100/100.

Reliable outcome prediction was not demonstrated. The critic recognized none of 17 goal-passing layouts. The measured gain was format learning; the simulator still determines outcomes.

### 3:30 to 4:00: Fine-tune two: the optimizer

A separate controlled test compares tuned, base and random proposals.

The optimizer learned from 1,200 simulator examples. On 20 unseen factories, penalty fell 12.64% with the adapter, versus 0.14% for the base model and 4.27% for random legal moves.

This separate pilot still had 21 invalid moves out of 60, and no full-goal successes. Neither adapter powers this replay.
