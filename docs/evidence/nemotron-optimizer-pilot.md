# Nemotron optimizer pilot

The fine-tuned model improved the held-out factory objective beyond both the base model and a random legal-move baseline in this small synthetic pilot. This is a separate experiment from the frozen website and video. It did not reach zero damage or the full goal on any of the 20 test factories.

## Measured result

Each arm started from the same 20 unseen buildings and received three proposal opportunities. The mean initial objective was 10,767.4625; lower is better. Final scores use four new demand days per building, after all proposal selection ended.

| Measure | Base Nemotron 8B | Fine-tuned Nemotron 8B | Random legal moves |
| --- | ---: | ---: | ---: |
| Mean final objective | 10,752.350 | 9,406.825 | 10,307.975 |
| Reduction in mean objective from initial layouts | 0.14% | 12.64% | 4.27% |
| Buildings improved / regressed / unchanged | 3 / 1 / 16 | 12 / 2 / 6 | 7 / 3 / 10 |
| Accepted moves on feedback days | 4 | 24 | 14 |
| Invalid proposals | 50 / 60 | 21 / 60 | 0 / 60 |
| Full goal passed on all final demand days | 0 / 20 | 0 / 20 | 0 / 20 |
| Zero damage on all final demand days | 0 / 20 | 0 / 20 | 0 / 20 |

Head to head, the tuned model beat the base model on 12 buildings, lost on two and tied on six. Against random moves, it won 12, lost four and tied four. These wins compare the final objective, not full-goal success. The percentage above is the reduction of the aggregate mean objective, not the average of individual percentage improvements.

This supports a narrow claim: one epoch of supervised training produced more useful machine-move proposals on these fresh synthetic factories. It does not establish a general factory optimizer or real-world safety. The tuned model still proposed 21 invalid moves, and two buildings regressed on new demand despite passing the feedback-day acceptance gate. There was no second training pass or selection using these test outcomes.

## What was trained

Base checkpoint: `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` at `54641c1611fcff44fa4865626462445e0a153fc7`. This is the 8B optimizer experiment, separate from the larger Nemotron models used in the agent demo and from the earlier critic adapter.

The input contains the complete current layout, fixed building constraints, measured simulator feedback and previous proposal outcomes. The target is one relocation of an existing sorter or packing station, or a stop action. The model cannot move docks, add stations, alter routing, change the building or modify the grader.

The training corpus contains 1,200 before/action/after examples from 60 buildings, with 200 validation examples from ten other buildings. The 20 test buildings are disjoint under rotation and reflection and excluded from training. Labels came from local bounded simulator search, not paid teacher-model calls. All 1,400 stored transitions were independently re-scored before training. Stop labels mean no acceptable move was found in the sampled candidates, not that a global optimum was proved.

Training used a fresh rank-8 LoRA adapter with 6,815,744 trainable parameters, learning rate 0.0001, microbatch one and eight-example accumulation. One epoch was 150 optimizer updates over 1,873,761 tokens. Only assistant tokens contributed to loss. The training process completed in 708.187 seconds on one Crusoe A100 80GB. Validation loss fell from 0.526269 to 0.323104. Validation loss is a training diagnostic; the factory scores above establish the measured improvement.

## Comparison and independent audit

Both model arms used the identical base checkpoint, reasoning-off prompt wrapper, parser, acceptance rules, deterministic decoding and 128-token output limit. Each made exactly 60 calls. The tuned adapter was enabled or disabled on the same private server. Actual token totals were 77,862 base and 90,040 tuned; both were below the equal one-million-token ceiling. Equal limits do not mean identical actual usage.

Simulator counts were 280 base, 396 tuned and 480 random, all below the same 480-scenario ceiling. Invalid actions consumed proposal opportunities without candidate simulation. No requests failed, no automatic retries occurred, no usage reservations remained, and no final-demand results entered proposal prompts.

The independent auditor replayed all 1,156 scenarios, reconstructed all 710 receipts, checked every action and retained layout, reproduced the random baseline and the aggregates, and verified the recovered adapter bytes. The unchanged grader hash was `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`.

The initial serving process failed CUDA initialization after successful training. The host GPU remained healthy. A fresh serving container loaded the same recovered adapter successfully; training was not repeated, and all evaluation requests used that verified server. The initial failure and restart logs are retained.

## Receipts and reproduction

- [Preparation and cost estimate](optimizer-pilot-plan.md)
- [Training receipt](optimizer-training-receipt.json) and [provenance](optimizer-training-provenance.json)
- [Results and per-building paired scores](optimizer-pilot-results.json)
- [Compact factory outcomes](optimizer-pilot-factories.csv)
- [Independent audit receipt](optimizer-pilot-audit.json) and [auditor source](optimizer-pilot-audit.ts)
- [Evaluation process timing](optimizer-evaluation-process.json)

Full prompts, responses and simulator traces remain in local `runs/optimizer-eval/test-v1/`. The dataset is in `runs/optimizer-data/v1/`. The recovered adapter and training metadata are in `runs/optimizer-recovery/optimizer/`; full VM logs and environment receipts are in `runs/optimizer-recovery/vm-output/`. These ignored artifacts were saved locally rather than added to the frozen demo.

With the original local artifacts and frozen source present, independently re-score without model calls:

```sh
npx tsx docs/evidence/optimizer-pilot-audit.ts --confirmed-complete \
  runs/optimizer-eval/test-v1 \
  runs/optimizer-audit/recheck.json \
  runs/optimizer-recovery/optimizer
```

Use a new output filename. The auditor rejects changed source hashes or an incomplete run. Re-checking the saved receipts does not authorize a new paid experiment.

## Cost and cleanup

The approved ceiling was $3 additional and 75 minutes from VM creation through deletion. The A100 and 128 GiB boot disk were verified deleted at 22:13:44 UTC on October 17, 2026. Observed lifecycle was 20 minutes 46 seconds, from the client-observed creation at 21:52:58 UTC. The temporary SSH key and known-host entry were removed after artifact recovery.

At the published $2/hour compute rate and $0.08/GiB-month storage rate, the estimated total is **$0.697145**, including storage with a 720-hour-month proration assumption. This is an estimate through confirmed deletion, not the posted bill. The actual posted charge was unavailable at closeout.

- [Deletion and cost receipt](optimizer-vm-deletion-receipt.json)
- [Empty instance list](optimizer-deleted-instances.png)
- [Empty disk list](optimizer-deleted-disks.png)

The unchanged application code passed 121 TypeScript tests, typecheck, and seven Python VM tests before execution. The independent post-run audit passed. The frozen site, video, grader, root README and Claude-owned loop/memory code were not modified by this pilot.
