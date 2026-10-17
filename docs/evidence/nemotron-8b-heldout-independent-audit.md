# Independent audit: Nemotron 8B layout critic

Audited 2026-10-17 21:42:13 UTC. The fine-tune reliably learned the required JSON contract, but its held-out predictions remain poor and frequently false-safe. These results do not establish factory optimization, reliable layout screening, or a learned world model.

## Integrity and scope

The frozen comparison used the same pinned `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` revision `54641c1611fcff44fa4865626462445e0a153fc7`, the same reasoning-off prompt profile, greedy decoding, and a 256-token output cap. The server enables or disables the adapter on one base model. Recovered adapter files match the completed training manifest.

All 100 selected cases are unique and cover five new buildings, 20 cases each. Training used 600 examples on 30 buildings; validation used 100 examples on five other buildings. A separate Python geometry canonicalizer found no train/test or validation/test building overlap, including rotations and reflections. Layouts and demand seeds are also disjoint.

Ground truth contains **75 valid and 25 invalid layouts**. Independently revalidating all 100 labels and simulating the 75 valid layouts on four fresh demand days each produced **zero mismatches across 300 scenario simulations**. Dataset, manifest, selection, grader and health-receipt hashes match the frozen records. Existing reserved final scenarios were not used.

All 200 model responses completed without request errors or duplicates. Independent parsing and arithmetic reproduced every aggregate, building-level and paired metric. Actual reported usage sums to **175,587 tokens**.

## Strict results

| Metric, all 100 cases | Base | Fine-tuned |
| --- | ---: | ---: |
| Exact output schema | 0/100 | 100/100 |
| Layout validity accuracy | 0/100 | 76/100 |
| Zero-damage flag accuracy | 0/100 | 42/100 |
| All-shipped flag accuracy | 0/100 | 66/100 |
| Goal-met flag accuracy | 0/100 | 56/100 |

The base returned JSON with the wrong schema in 81 cases and output that was not bare JSON in 19 cases. It therefore supplied **no accepted predictions** under the frozen contract. Its zero accepted false-safe outputs and unavailable numeric MAE are not evidence of safety or numerical accuracy.

The tuned model wrongly rejected 23 valid layouts and wrongly accepted one invalid layout. It supplied numeric and boolean predictions for only **52 of the 75 valid layouts**; the other 23 received null outputs after an incorrect invalid classification.

## Valid-layout diagnostics

The majority column is a post hoc diagnostic using the label distribution in these 75 test cases, not a trained baseline or a tuning input. The all-75 column treats missing/null predictions as incorrect. Conditional accuracy only covers the 52 valid layouts for which the tuned model emitted numeric and boolean predictions.

| Flag | Tuned, all 75 valid layouts | Tuned, conditional 52 | Majority label, all 75 |
| --- | ---: | ---: | ---: |
| Zero damage | 18/75 (24.0%) | 18/52 (34.6%) | Always false: 41/75 (54.7%) |
| All shipped | 42/75 (56.0%) | 42/52 (80.8%) | Always true: 61/75 (81.3%) |
| Goal met | 32/75 (42.7%) | 32/52 (61.5%) | Always false: 58/75 (77.3%) |

All three tuned accuracies over the full valid subset fall below the simple majority diagnostic. Base conditional accuracy is unavailable because its schema coverage is zero.

False-safe tuned predictions are substantial:

| Flag | False-safe, all cases | False-safe rate on actually unsafe valid layouts |
| --- | ---: | ---: |
| Zero damage | 35/66 at-risk cases | 34/41 (82.9%) |
| All shipped | 11/39 at-risk cases | 10/14 (71.4%) |
| Goal met | 16/83 at-risk cases | 16/58 (27.6%) |

The model correctly identified **zero of the 17 actually goal-passing layouts**. Four received an explicit false prediction and 13 were wrongly classified invalid.

Numeric MAE is conditional on the 52 valid layouts with numeric outputs; **23 valid layouts are missing**: objective 23,050.31; makespan 170.07 seconds; damaged 7.90 packages; missorts 6.73 packages; unshipped 4.52 packages. Base numeric MAE is unavailable, so no base-to-tuned numerical improvement is established.

The recorded 100 categorical paired wins and 52 numerical wins primarily reflect the base failing the output contract. They must not be interpreted as 100 better factory decisions. Five synthetic rectangular buildings and one training seed also do not establish broad generalization.

## Evidence

- `runs/finetune-eval/test-8b-v1/evaluation-plan.json`: frozen comparison and limits.
- `runs/finetune-eval/test-8b-v1/responses.jsonl`: raw outputs, usage and errors.
- `runs/finetune-eval/test-8b-v1/metrics.json`: unchanged primary metrics.
- `runs/vm-recovery/critic/manifest.json`: completed training and adapter hashes.
- [Supplementary audit JSON](nemotron-8b-heldout-independent-audit.json): independent checks, valid-only diagnostics, majority baselines and source hashes.

No model, training, scorer, grader, website or video was changed during this audit.
