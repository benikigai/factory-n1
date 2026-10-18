# Fresh-factory optimizer comparison

The detached VM evaluation completed on all 20 newly sealed factories. The original-data, three-epoch Nemotron adapter performed best among the four model variants. It reached the unchanged full goal on 10 of 20 factories, compared with one for the base. Zero damage across every fresh factory remains unsolved.

The frozen hackathon site and video were not changed. This run reused saved model weights; no retraining occurred.

## Measured results

Each factory has four final demand days of 100 packages each. Objective is averaged across all 80 final factory-days; lower is better. Damage is the total across those 8,000 package deliveries. Full goal requires every final day to ship all packages within 25 minutes, with at most one mis-sort and zero damage.

| Model or reference | Objective after 3 proposals | After 12 | Damaged packages after 12 | Full goal after 12 |
| --- | ---: | ---: | ---: | ---: |
| Base Nemotron 8B | 10,988.075 | 10,988.350 | 963 | 1/20 |
| Original data, archived one epoch | 10,622.963 | 9,980.238 | 830 | 2/20 |
| Original data, three epochs | 9,092.950 | **6,948.575** | **427** | **10/20** |
| New curriculum, one epoch | 10,713.963 | 9,773.850 | 802 | 3/20 |
| Seeded legal random moves | 10,876.063 | 9,769.538 | 802 | 1/20 |
| Privileged geometric planner | 4,988.225 | 4,269.825 | 70 | 19/20 |

At twelve proposals, the three-epoch adapter reduced mean objective **36.76% versus base** and total damage **55.66%**. It beat base on objective in 17 factories, tied three, and lost none. Its 37.32% improvement from the initial layouts uses a different denominator. One factory already met the goal initially; the adapter newly solved nine.

The new curriculum did not beat random moves on mean objective. The geometric planner uses privileged rules and extra planning computation, so it is a separately labeled reference, not a fifth model with the same inference budget. It still outperformed the learned policies overall.

## What this establishes

The saved three-epoch adapter is the strongest tested model artifact on this synthetic cohort. Its goal passes increased from four after three proposals to ten after twelve, showing that additional search also helped. The archived one-epoch weights differ from the first epoch of the later training job, so this experiment does not perfectly isolate epoch count from training randomness. It does not establish performance on real factories.

All models used the same pinned `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` base, unchanged prompts and grader, greedy decoding, and equal offered limits of twelve proposals per factory. Stops could use fewer proposals. Four feedback days were available during search; four separate final days remained hidden until all searches ended. All twenty factories, including losses and ties, stayed in the denominator. The fresh cohort excludes prior training, validation, exploratory and test identities, including both earlier test cohorts.

## Verification and cleanup

The model server and evaluator ran on the A100 VM as detached systemd services. Evaluation took 14 minutes 40.5 seconds, with **948 resolved model requests, zero unknowns, and 1,677,102 tokens**. No request was automatically retried. An independent audit reconstructed proposals and acceptance and ran **4,936 simulator evaluations**. It verified the model, adapter, grader, data and prompt hashes. The recovered archive passed all 2,201 file hashes.

The VM and its 128 GiB boot disk were confirmed deleted after 21.45 minutes from the conservative budget anchor. Temporary SSH files were removed. The published-rate usage estimate is **$0.720157 against the approved $3 cap**; the posted invoice has not been verified. See [deletion receipt](optimizer-v3-vm-deletion-receipt.json).

Cleanup recorded an absent evaluator unit and a server-stop timeout after evaluation completed, followed by forced container removal. These were cleanup diagnostics, not unresolved inference requests; provider deletion was verified separately.

- [Independent score audit](optimizer-v3-audit.json)
- [Runtime, fresh-cohort and archive audit](optimizer-v3-runtime-audit.json)
- [Frozen run plan](optimizer-v3-plan.md)
- [Separate 3D comparison](http://127.0.0.1:5194/?factory=optimizer-v3-test-building-5&left=factory-optimizer-base&right=factory-optimizer-old3&snapshot=round12)

The 3D page includes every factory and the three- and twelve-proposal snapshots. Its animation shows a single selected day; summary cards average four days. Factory 5 is an example: base mean objective 10,353.25 and 11 damaged per day, versus 3,715 and zero damage for the three-epoch adapter. This example does not replace the full-cohort results above.
