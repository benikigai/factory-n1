# Factory N+1 judge demo

Updated October 17, 2026 for the collapsible station, demand, agent and Nemotron panels. Allow about six minutes including clicks. Read only the quoted text aloud. The instructions and checkpoints are for you.

For the automated version, click **Guided demo · 6 min**. It loads the correct recording and splits this walkthrough into 15 steps. Use **Next** and **Back** to open the matching panels and read the on-screen speaking notes. **Exit demo** or **Finish** restores the clean factory. You can still use the manual route below.

## Set up before the judges arrive

1. Open http://localhost:5180/?run=live-a-5.
2. In **Select run**, select **live-a-5 · recorded**.
3. Click **Factory layouts**, then **Overview**.
4. If a station inspector is open, click its **Close** button.
5. Open **Peak demand · 100 packages**. Select **Run replay**, then close the demand panel.
6. Close **How sorting & damage work**, **Nemotron fine-tune results**, and **Results & agent evidence** if open.
7. Drag the **Replay time** slider all the way left. Select **16×** playback speed. Leave playback paused.

Checkpoint: the badge says **RECORDED**, the scenario is **peak-202**, and the clock reads **00:00**. The baseline is on the left and the champion is on the right. This walkthrough requires no new model calls.

## 1. Introduce the factory

**Click:** **Play**. Point to the four process buttons: **1. Receive**, **2. Sort**, **3. Pack**, **4. Ship**.

**Say:**

“This is Factory N+1. We built a simulated fulfillment center where agents redesign the operation and test their changes.

Packages arrive at receiving, pass through sorting, get packed, and leave through a shipping dock for destination A, B, or C. Each package has a size, destination, and fragility flag.

Each station handles one package at a time. So station placement, packing capacity, and queues affect the result.”

## 2. Show why the starting factory struggles

**Click:** The **pack-1** label on the **left baseline**. Open **How this station works**.

**Point to:** **Sizes: S, M** and **Destinations: A, B, C**.

**Say:**

“Our starting packing stations only support small and medium packages. Large packages have no eligible packing station.

The sorter checks size and destination first. Among eligible stations, it chooses the shortest queue, then the shortest route. If none qualifies, it uses a fallback and records a mis-sort.”

**Click:** **Close** in the station inspector. Open **How sorting & damage work**.

**Say:**

“Damage follows a separate rule. A fragile package gets damaged when any single trip exceeds 12 grid cells. Exactly 12 is safe. These are explicit simulator rules we can reproduce.”

**Click:** Close **How sorting & damage work**. Click **Pause** if playback is still running.

## 3. Explain normal, peak and fragile demand

**Click:** Open **Peak demand · 100 packages**. Click **Normal**.

**Say:**

“Normal demand spreads 100 arrivals across 20 minutes, with a 10 percent fragile probability.”

**Click:** **Peak**.

**Say:**

“Peak compresses arrivals into five minutes, which stresses the queues.”

**Click:** **Fragile**.

**Say:**

“Fragile demand raises the fragile probability to 35 percent. This exposes long routes.

These buttons run the same saved layouts through the simulator. They use different seeded demand samples, without new model calls.”

**Click:** **Run replay**, then close **Peak demand · 100 packages**.

Checkpoint: the badge returns to **RECORDED**. The scenario returns to **peak-202**. Profile selection resets playback to the start.

## 4. Show the measured improvement and its remaining failure

**Click:** Drag the replay slider all the way **right**. Open **Results & agent evidence**. Scroll to **Before / after**.

**Point to:** **Makespan (s)**, **Missorts**, and **Damaged**.

**Say:**

“In this recorded agent run, the agents moved the sorter and added packing stations that accept large packages.

On this demand day, completion time fell from 1,581 seconds to 729 seconds. About 26 minutes down to 12.

Mis-sorts fell from 16 to zero. Both factories shipped all 100 packages.

But damage only fell from 14 to 13. The factory improved and still failed the zero-damage goal.”

**Click:** Close **Results & agent evidence**. Click **pack-1 on the right champion**. Open **Routing & failure details · 4 arrived damaged**.

**Point to:** **sort-1 → pack-1**, **15 cells**, and **4 first damaged on this trip**.

**Say:**

“Here is one remaining problem. Four fragile packages first get damaged on this 15-cell trip to pack-1. The next improvement needs to address the route.”

**Click:** **Close** in the inspector.

## 5. Show what the agents actually did

**Click in order:**

1. **Agent factories**.
2. **Designers · Agent team ↗** in the inspector.
3. **Flow designer · Model agent ↗**.
4. **Generation 1 · Recorded proposal ↗**.
5. **simulate_layout · Tool receipt**.

Checkpoint: the inspector shows receipt **chatcmpl-tool-9dabf19c21598c61: ok**.

**Say:**

“We can inspect the work behind the change. Researchers suggest ideas. Designers propose layouts. The simulator scores them. The controller accepts changes that pass its checks, then feeds results and saved lessons into the next round.

That is the recursive loop in this prototype: propose, test, learn, repeat. These nested views expose real execution records.”

**Click:** **Factory layouts**.

## 6. Show what the critic fine-tune proved

**Click:** Open **Nemotron fine-tune results**. Keep its nested details closed initially.

**Say:**

“Separately, we trained two specialist adapters on the same Nemotron Nano 8B base model. An adapter changes a small fraction of the model's parameters for a specific job.

The critic learned to predict factory outcomes. Its response format improved from zero out of 100 valid responses to 100 out of 100.

But it recognized none of the 17 goal-passing layouts. We proved format learning. Useful outcome prediction was not demonstrated.”

**Optional click if asked about accuracy:** Open **Critic test details**.

**Optional say:**

“It predicted zero damage correctly on only 18 of 75 valid layouts. A simple majority prediction got 41 correct. So we keep the simulator as the judge.”

Close **Critic test details** before moving on.

## 7. Show what the optimizer fine-tune proved

**Point to:** **2. Optimizer · propose station moves** and its comparison table.

**Say:**

“The optimizer learned from 1,200 examples of layouts, actions, and simulator results.

We tested it on 20 unseen factories. Each method got three proposal opportunities per factory. Final scoring used fresh demand days.

The tuned model reduced the average penalty score by 12.64 percent from the starting layouts. The base model reduced it by 0.14 percent. Random legal moves reduced it by 4.27 percent.

That supports a specific result: training produced more useful station moves in this synthetic test.”

**Point to:** **Still limited**. Open **Optimizer test details**.

**Say:**

“It still proposed 21 invalid moves out of 60. None of the 20 factories achieved zero damage or the full goal. Against the base model, it won on 12 factories, lost on two, and tied on six.”

**Click:** Close **Optimizer test details**.

## 8. Close with the scope clearly stated

**Point to:** The note at the top of **Nemotron fine-tune results**.

**Say:**

“These training experiments are separate from the factory replay. The adapters are not connected to this UI yet.

We have a working agent improvement loop, inspectable evidence, and a small measured gain from training the optimizer.

Every proposed improvement still has to survive the simulator.”

**Click:** Close **Nemotron fine-tune results**. Click **Overview** to end on the factory.

## Optional technical detail

Open **Nemotron fine-tune results → Shared model and training setup** only if asked.

**Say:**

“These are independent LoRA adapters on the same eight-billion-parameter base. Each trained about 6.8 million parameters for one epoch on a Crusoe A100. We did not train the optimizer on the critic.”

## Quick recovery during the demo

- If a number differs, open the demand panel and select **Run replay**. Confirm **live-a-5**, **RECORDED**, and **peak-202**.
- If a station appears twice, choose the left label for the baseline and the right label for the champion.
- If you lose the camera position, click **Overview**.
- If you get lost in the agent tree, click **Factory layouts**.
- If a panel is below the screen, scroll the right sidebar. On narrow screens, the sidebar sits below the factory.
- The clock ends around **26:22** because playback includes the final animation. Quote the measured **1,581 seconds** from the results table.

## If judges ask

| Question | Short answer |
| --- | --- |
| Did the factory teach itself? | The agent loop learns through feedback and saved lessons. Separately, we used supervised fine-tuning to change model parameters. The UI does not train itself while running. |
| What exactly did you train? | Two independent rank-8 LoRA adapters on `nvidia/Llama-3.1-Nemotron-Nano-8B-v1`. Each trains about 6.8 million parameters. One predicts outcomes; the other proposes moving an existing sorter or packing station. |
| Where did training labels come from? | The deterministic simulator. Optimizer examples came from a bounded search for useful moves. We did not use paid teacher-model labels for that dataset. |
| Was the optimizer comparison fair? | Each arm started from the same 20 unseen buildings with three proposal opportunities. Both models had the same output limit, parser, and acceptance rules. Final scoring used four fresh demand days per building. Actual token use and simulation counts differed. |
| Is 12.64% an improvement over the base model? | It is the reduction in the aggregate mean score from the starting layouts. The base arm's corresponding reduction was 0.14%. It is not a throughput percentage or a base-relative percentage. |
| How often did the tuned optimizer beat the base? | On 12 buildings. It lost on two and tied on six. It also produced 21 invalid proposals out of 60. |
| Why not let the critic approve changes? | Its format improved, but useful prediction accuracy was not demonstrated. It recognized none of the 17 genuinely goal-passing examples. The simulator remains the authority. |
| Does this prove real warehouse savings? | No. This is a reproducible synthetic experiment with simplified travel, processing, and damage rules. Real operations need calibration and external validation. |
| Does recursive mean agents create arbitrary agents? | The current backend uses fixed roles. The UI exposes nested execution records. Arbitrary dynamic child-agent creation remains unimplemented. |
| What remains to do? | Connect the optimizer adapter to the UI, improve invalid-action handling, expand the unseen test set, and meet the zero-damage goal. Those are next steps, not completed features. |

## Evidence

- [Completed fine-tuning results](EVIDENCE.md)
- [Original replay](../recorded/live-a-5/replay.json)
- [Original run summary](../recorded/live-a-5/summary.json)
- [Simulator rules](../src/sim/config.ts)
- [Integration map and acceptance checks](HANDOFF.md)
