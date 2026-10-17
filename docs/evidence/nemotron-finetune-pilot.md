# Nemotron critic fine-tuning pilot

Status: training, the 100-pair held-out comparison, independent audit and VM deletion completed. This evidence is separate from the frozen site and video.

## Training receipt

The approved pilot used one Crusoe A100 80GB PCIe VM in `us-east1-a`, capped at $6 additional and two hours. The VM was created at 14:25:02 PT on October 17, 2026. Full training began at approximately 14:28:52 PT, before the 14:50 start-or-park deadline. A backup shutdown timer was armed; deletion was independently observed at 14:42:49 PT, after artifact recovery and evaluation.

The student is `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` at revision `54641c1611fcff44fa4865626462445e0a153fc7`. It is a dense text critic, distinct from the Nemotron 3.5 Super VL visual inspector. Training and both evaluation arms use the same documented `detailed thinking off` prompt transformation.

One epoch completed on 600 examples from 30 synthetic buildings. There are 100 validation examples from five separate buildings and 100 held-out examples from five further buildings. The training VM received train and validation data only. The grader is unchanged: `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`.

| Training property | Recorded value |
| --- | --- |
| Job | `vm-critic-64b484301cc048179ebe7e864f175643` |
| Optimizer steps | 75 |
| LoRA | rank 8, alpha 16, attention projections only |
| Trainable parameters | 6,815,744 |
| Full training runtime | 216.455 seconds |
| Training tokens, including prompts | 508,558 |
| Peak allocated GPU memory | 17,836,600,832 bytes |
| Validation assistant-token loss before | 1.4291206384883828 |
| Validation assistant-token loss after | 0.2795293734645112 |

The adapter and training manifest were recovered locally and their SHA256 hashes verified. Adapter weights hash: `e87c016a8e82c10d36236a66c6b15b03123a1e6f3037b6c68f23df8dcbee3ce8`. Adapter configuration hash: `a68d23b308225abc211a4e098c09cf0cc13d1516394225c8568b983c60914f36`.

Lower validation loss does not establish better factory decisions. The frozen held-out comparison is required for that narrower prediction-quality result.

## Held-out comparison

The plan freezes 100 examples, 200 model calls, temperature zero, and 256 output tokens per call. The base arm disables the adapter on the exact same loaded base checkpoint. The tuned arm enables it. A health receipt binds the serving endpoint to the training job and checkpoint before test data is opened.

All 200 calls completed with 175,587 reported tokens, no failed calls and no uncertain token reservations. The tuned model met the strict output schema on 100/100 examples; the base model met it on 0/100. This is evidence of output-contract learning. It does not establish useful factory-outcome prediction.

The tuned model identified layout validity correctly on 76/100 cases, compared with 75/100 for always predicting valid. Its zero-damage predictions were correct on only 18/75 valid layouts, versus 41/75 for always predicting damage. It correctly identified none of the 17 goal-passing layouts. The gain is format compliance; useful outcome prediction was not demonstrated. The [independent audit](nemotron-8b-heldout-independent-audit.md) includes conditional metrics, missing predictions and majority-label comparisons; [the original metrics](nemotron-critic-test-results.json) remain unchanged.

The comparison measures JSON validity, layout-validity and outcome-flag accuracy, false-safe predictions, and numerical prediction errors. It does not run either model as a factory optimizer or establish an improvement in real factory throughput.

## Cleanup and cost

The VM and its boot disk are deleted. The console showed no remaining instances and no disks. The [deletion receipt](nemotron-vm-deletion-receipt.json) records the observed times and links to screenshots.

From creation to confirmed absence was at most 1,067 seconds (17 minutes 47 seconds). Charging that entire interval at the public $2/GPU-hour rate gives $0.592778 compute. Prorated boot storage adds about $0.004158, for a conservative runtime-based estimate of **$0.596935**, approximately **$0.60 against the approved $6 cap**. The estimate intentionally includes startup and shutdown time.

The final billed charge is not posted yet. Crusoe's usage dashboard states that usage updates daily shortly after midnight UTC. Storage rounding and account-specific billing have not been confirmed, so the runtime estimate is not an invoice receipt.

Private manifests, full prediction receipts and recovered adapters are in ignored `runs/vm-recovery/` and `runs/finetune-eval/test-8b-v1/`. No training inputs, private keys or full model weights are included in the public static demo.

Sources: [Crusoe pricing](https://www.crusoe.ai/cloud/pricing), [VM billing](https://docs.crusoecloud.com/compute/virtual-machines/overview/#vm-billing), [NVIDIA model card](https://huggingface.co/nvidia/Llama-3.1-Nemotron-Nano-8B-v1).
