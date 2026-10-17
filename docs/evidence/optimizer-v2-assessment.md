# Optimizer v2 assessment and proposed cost

The next step should improve the training examples and give the model enough moves to finish. Extra epochs remain worth measuring, but the current evidence does not show that repeating the same examples will solve the problem. No new GPU was rented, no training was started, and the frozen website/video and grader were not changed.

## What the offline checks established

A deterministic geometric planner constructed legal zero-damage layouts for all 20 already-consumed v1 test factories and 20 additional exploratory factories. The planner keeps the same docks, sorter count, packing-station count, capabilities, budget and spacing rules. It places every eligible transport leg within the existing 12-cell fragile-package threshold.

All 40 layouts met the full goal on their four assessment days. All 121 intermediate moves also passed the existing feedback acceptance rule. An independent audit re-scored every construction and move. This shows a useful teacher and baseline exist. It does not show the neural optimizer has learned those solutions, and it does not establish full-goal performance on arbitrary future demand.

| Offline geometric planner | Consumed v1 factories | Exploratory factories |
| --- | ---: | ---: |
| Zero damage and full goal after complete plans | 20/20 | 20/20 |
| Zero damage and full goal after first three moves | 15/20 | 14/20 |
| Plans needing more than three changed stations | 5/20 | 6/20 |
| Maximum station changes in a complete plan | 5 | 6 |

The move lower bound applies to making every eligible route safe, not to getting lucky with a finite demand sample that leaves an unsafe route unused. The 20 exploratory factories have now been consumed and must be excluded from the next final test.

The geometric endpoint searches took about 0.85 seconds in total, excluding simulation and audit time. For this narrow simulator, this deterministic planner is already a strong, cheap solver. Fine-tuning can teach the model to imitate it, but should be compared against it honestly.

## Why data quality is the first suspect

The current 1,200-row training set contains 212 targets with zero damage on both checked day sets, and 211 that meet the full goal. It contains useful successes, but mostly incremental improvements and trajectories truncated at three moves.

There are no rejected or invalid prior actions in any training example. All 1,034 history entries describe accepted moves. In the actual evaluation, all 60 tuned replies were valid JSON, but 21 proposed colliding station placements. This is a spatial-legality and recovery problem, not a JSON-format problem.

The model proposed no sorter moves despite 336 sorter-move labels in training. It also proposed destination `(9,10)` in 15 of 60 calls, while that coordinate occurs in only 15 of 1,189 training move labels. This supports testing geometry grounding and action coverage. It does not by itself distinguish undertraining from an imitation or observation problem.

## Proposed training data

For a clean comparison, begin with 1,200 new training examples and 200 validation examples from separate new buildings, with approximately the same token budget as v1. Keep the pinned base, prompt/action contract, rank, learning rate and batch settings fixed.

Use complete verified teacher trajectories from varied starting layouts, up to the point where damage is zero and the full goal passes. Include late-stage repairs, truthful completion/stop targets, sorter and packing moves, mirrored/rotated geometries, and correction examples whose history includes a real rejected or colliding attempt. In a correction example, the bad move belongs in the input history; the desired output is the verified corrective move.

Keep the existing prompt schema for this comparison so a data-only change is not confounded with a new interface. Explicit safe-route observations or selecting from a list of legal candidate actions are promising later experiments, but should be tested separately or applied equally to all arms.

## Experiment that separates data from epochs

| Model arm | Training condition |
| --- | --- |
| Raw base | Pinned Nemotron Nano 8B without adapter |
| Current optimizer | Archived v1 data, one epoch |
| More epochs | Original v1 data, three epochs from the pinned base |
| Better data | New verified curriculum, one epoch |

Keep the same LoRA rank 8, learning rate 0.0001 and one-move JSON action format. Save and inspect epoch checkpoints using validation factories. The current trainer is explicitly one epoch; raising `max-steps` alone will not run additional epochs. The saved adapter has no optimizer state, so do not describe loading it and training twice more as an exact resumed three-epoch run.

Freeze 20 completely new final factories and demand seeds after excluding all prior training, validation, test and exploratory buildings. Give each model 12 proposal opportunities per factory, for at most 960 model calls total. Retain layouts at proposals 3 and 12, then score both snapshots only after every search finishes. This separates the effect of the move budget from the training condition without feeding final-demand outcomes back into search. Include random-move and deterministic geometric baselines, reporting their actual compute separately.

Primary outcomes: zero damage on every final demand day, full-goal passes, invalid moves, and moves needed. Secondary: objective and throughput. Keep incomplete cases and failed requests in the denominator. Do not reuse the current 20 factories as a fresh final test. This experiment measures the separate data effect and old-data epoch effect; it does not measure the interaction of better data with three epochs.

## Cost estimate before execution

Crusoe's current published A100 80GB PCIe price is $2/hour, with persistent storage at $0.08/GiB-month. The previous one-epoch run took 708.187 seconds. Its 120-call comparison took 136.992 seconds, with short 22-token outputs.

| Work on one A100 | Estimated duration |
| --- | ---: |
| Old data for three epochs plus new data for one epoch | About 47 minutes |
| Private serving and up to 960 model calls | 20-30 minutes |
| Setup, loading, recovery and cleanup | 8-15 minutes |
| Total, allowing some overlap in the bounds | About 75-95 minutes |

Estimated compute plus a 128 GiB disk: **$2.52-$3.19 additional**. Proposed approval ceiling: **$4 additional**, with a hard **100-minute creation-to-deletion limit**. At published rates, 100 minutes is about $3.36 including prorated disk storage; the remaining margin is not permission to extend the runtime. Stop work by minute 90, recover artifacts, and delete the VM and disk by minute 100. If incomplete, report the incomplete comparison rather than extend or repeat it.

The estimate assumes the new corpus stays near v1's token budget. Final tokenization and a smoke test must happen before renting the VM. No new teacher-model API spend is needed; labels come from the local simulator and geometric solver. No ongoing hosting is included. The current published native fine-tuning catalog does not establish that the earlier API blocker has been fixed, and switching base models would confound this experiment.

## Evidence

- [Compact assessment receipt](optimizer-v2-assessment.json)
- Detailed local data audit: `runs/optimizer-v2-assessment/data-diagnosis.json`
- Geometric constructions and move sequences: `runs/optimizer-v2-assessment/geometric-feasibility.json`
- Independent feasibility audit: `runs/optimizer-v2-assessment/feasibility-audit.json`
- Rerun the offline audit: `npx tsx runs/optimizer-v2-assessment/audit-feasibility.ts`

Sources: [Crusoe pricing](https://www.crusoe.ai/cloud/pricing), [NVIDIA fine-tuning and validation guidance](https://docs.nvidia.com/nemo/automodel/latest/recipes-e2e-examples/sft-peft). Cost extrapolations and recommendations are ours; they are not vendor guarantees.
