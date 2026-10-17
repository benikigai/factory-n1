# Optimizer v2 controlled pilot

Approved scope: one Crusoe A100 80GB PCIe, $4 additional maximum, at most 100 minutes from creation through verified instance and boot-disk deletion. The frozen website and video are excluded.

## Comparison

All model arms use `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` at revision `54641c1611fcff44fa4865626462445e0a153fc7`, the existing single-move JSON contract, the same reasoning-off wrapper, and the unchanged simulator grader.

| Arm | Data | Epochs |
| --- | --- | --- |
| Base | None | 0 |
| Archived optimizer v1 | Original 1,200 examples | 1 |
| Longer training | Original 1,200 examples | 3 |
| Better training data | New 1,200 verified examples | 1 |

Training keeps LoRA rank 8, alpha 16, learning rate 0.0001, accumulation 8 and microbatch 1. One epoch contains 150 optimizer updates. The three-epoch arm starts from the pinned base, not an adapter without optimizer state. Validation loss is saved after every epoch. No checkpoint is selected using final test scores.

The new curriculum contains complete paths to verified goal-satisfying layouts, sorter moves, finishing moves, stop examples and actual failed-action histories followed by corrective actions. Training verification days participate in data selection and are not an unbiased evaluation set.

## Evaluation and costs

Twenty new sealed factories are excluded from every previous training, validation, test and exploratory geometry set. All four policies receive up to 12 proposal opportunities from identical starts. Results after 3 and 12 proposals are saved. Model order rotates; decoding is greedy with at most 128 output tokens and no automatic retries. Maximum model calls: 960. Pending or unknown requests are never retried.

Final package days are evaluated only after all searches stop. Random and geometric-planner baselines are separately labeled, including planning simulations and CPU time. The geometric planner is privileged procedural logic, not a trained-model result.

Published rates verified October 17, 2026: A100 PCIe $2/GPU-hour and storage $0.08/GiB-month. With a 128 GiB boot disk, estimated 75–95 minutes costs $2.52–$3.19; 100 minutes costs about $3.36. These are estimates, not posted charges. Source: https://www.crusoe.ai/cloud/pricing

Work stops by minute 90 for artifact recovery and deletion. A host shutdown timer is a backup, not deletion proof. Save adapter files, hashes, training manifests, model provenance, exact requests, scores and screenshots confirming no instance or disk remains. Report any incomplete comparison rather than extend the budget.

## Reproducibility limit observed during training

The archived one-epoch artifact and the first checkpoint of the new three-epoch run have identical pre-training validation loss (0.5262690003558335), base revision, dataset token counts and hyperparameters, but different adapter hashes. Post-epoch validation loss is 0.3231038418092577 for the archive and 0.32272349926907345 for the new run. The new schedule uses a private seeded Python RNG; the archived recipe shuffled global RNG state after model loading. Actual old batch order and initial LoRA hashes were not recorded, and deterministic GPU execution was not enforced. The comparison therefore describes four trained artifacts from a single seed; it cannot attribute differences solely to the number of epochs. No final test was opened or policy changed after this observation.
