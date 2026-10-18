# Fresh comparison on a VM

Status: prepared for a new spending approval. No VM has been created for this run.

Reuse the pinned Nemotron Nano 8B base and the three recovered adapters: original data / one epoch, original data / three epochs, and new curriculum / one epoch. This is a new evaluation cohort, not another training run. The earlier incomplete results remain intact.

## Measurement

- Twenty fresh factory geometries, excluding all previous training, validation, test, development and exploratory identities.
- Four feedback days and four separate final days per factory, each with 100 packages.
- Same four model artifacts, prompts, grader, rotating model order and 12 proposal opportunities per factory.
- At most 960 model requests, 128 output tokens per request, 4 million charged or reserved tokens per arm, and 1,280 evaluator simulations per arm.
- Greedy decoding and no automatic retries. Unknown requests stop the run and remain counted.
- Final days open only after all searches stop. A completed comparison requires all twenty factories; partial results cannot establish a winner.

The old single-seed limitation remains: the archived one-epoch weights differ from the first epoch of the fresh three-epoch training run. This compares saved model variants, not a perfectly isolated epoch-count intervention.

## Execution and cleanup

The model server and TypeScript evaluator run as separate systemd-managed containers on one A100 80GB PCIe VM. Inference uses local loopback. The supervisor, checkpoints and outputs live on the VM, independent of the laptop's SSH connection. No model port is exposed publicly.

Setup must finish by minute 20 or the run parks. Evaluation is capped at 50 minutes. A finalizer starts by minute 72 and an independent timer powers off the VM by minute 75. Retrieve and verify the artifact archive, then delete the VM and boot disk by minute 85. Poweroff alone does not count as deletion. A recovery-only restart must remain within the same original $3 and 85-minute limits; it cannot restart evaluation or extend deadlines.

Before model evaluation, a CPU container smoke test checks imports, writable output mounts and the unchanged grader. The server must report the exact expected model hashes. Actual Docker, GPU and systemd behavior remains a launch-time check.

## Cost estimate

Proposed additional cap: **$3**, including cleanup, with at most **85 minutes** from creation through deletion.

Crusoe lists the A100 80GB PCIe at $2 per GPU-hour and persistent disks at $0.08 per GiB-month, checked October 17, 2026. A 128 GiB disk adds about $0.0142 per hour using a 720-hour month. [Published pricing](https://www.crusoe.ai/cloud/pricing)

Expected total duration is 40–60 minutes, approximately **$1.34–$2.02**. The full 85-minute allowance is approximately **$2.86**. These are usage-based estimates, not posted charges. The previous 106 resolved requests averaged 1.304 seconds; 960 requests at that rate take about 21 minutes, but longer prompts and setup can increase runtime.

Keep code, results and replay separate from the frozen hackathon site and video. After completion, independently reconstruct the simulator scores, publish the full comparison in the separate viewer, and retain the cleanup receipt.
