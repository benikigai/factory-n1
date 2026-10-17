# Optimizer training pilot: interrupted evaluation

Training completed and the adapters were recovered. The intended nineteen-factory continuation did not complete. A second SSH disconnect left another request with unknown completion, so the evaluator stopped without retrying it. No nineteen-factory winner is established.

The model is `nvidia/Llama-3.1-Nemotron-Nano-8B-v1`, with LoRA adapters trained on the approved Crusoe A100. The frozen demo and video were not changed.

## Verified exploratory results

Only factories 1 and 10 completed all four model arms. These are the first two completed factories in the fixed execution order, not a representative sample. Across their eight final package days:

| Model | Mean objective, lower is better | Damaged packages | Factories meeting the full goal |
| --- | ---: | ---: | ---: |
| Base | 7,878.375 | 55 | 0 of 2 |
| Original data, archived one epoch | 5,014.500 | 17 | 0 of 2 |
| Original data, three epochs | 3,732.125 | 0 | 2 of 2 |
| New curriculum, one epoch | 6,236.625 | 33 | 1 of 2 |

The three-epoch adapter produced zero damage on these two completed factories. This does not establish zero damage on fresh factories generally, or prove that more epochs are better than better data. The archived one-epoch weights also differ from the first epoch of the new three-epoch training run, so epoch count is not perfectly isolated.

An independent audit ran 504 simulator evaluations, checked action acceptance and final scores, verified model/data/grader hashes, and confirmed the original interrupted evidence remained unchanged. The partial audit and the separate local 3D viewer expose only these completed cases. The viewer has no aggregate winner or win-rate headline.

## Training and accounting

Both new training jobs completed: 150 optimizer steps for the new curriculum and 450 for three epochs on the original data. All adapters and epoch checkpoints were retrieved before VM deletion. Validation loss is recorded in `optimizer-v2-training.json`; losses from different validation datasets must not be compared as a shared benchmark.

There were 108 combined model requests: 106 resolved and two unknown. The ledger retains 187,664 known tokens and 21,743 reserved tokens for the unknown requests. Neither unknown request was retried. Factory 11 was excluded by the approved continuation rule; factory 12 was interrupted by the second disconnect. The remaining sixteen factories did not receive model optimization.

The VM and its boot disk were confirmed deleted, and temporary SSH files were removed. The conservative published-rate estimate is **$2.32 against the $4 cap**, counting the stopped interval as GPU time. The actual posted invoice is not yet verified; see `optimizer-v2-vm-deletion-receipt.json`.

Local replay: `http://127.0.0.1:5193/`. This is an interrupted-pilot evidence view, separate from the frozen demo.

Next step, if separately approved: run inference and the evaluator together on a stable host using the recovered adapters and a newly sealed test set. No further paid run is authorized by this report.
