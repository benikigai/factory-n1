# Completed Nemotron pilot results

Verified October 17, 2026 from the completed pilot reports. These are separate experiments from the UI recording and are not live model calls.

Both use independent LoRA adapters on `nvidia/Llama-3.1-Nemotron-Nano-8B-v1`, revision `54641c1611fcff44fa4865626462445e0a153fc7`.

## Critic

Trained on 600 examples from 30 synthetic buildings. Evaluated on 100 held-out examples from five other buildings.

| Measure | Result |
| --- | --- |
| Required output format, base | 0/100 |
| Required output format, tuned | 100/100 |
| Tuned layout validity | 76/100, versus 75/100 always-valid baseline |
| Tuned zero-damage prediction | 18/75 valid layouts, versus 41/75 majority baseline |
| Actual goal-passing layouts recognized | 0/17 |

The result demonstrates format learning. Useful factory-outcome prediction was not demonstrated.

## Optimizer

Trained on 1,200 examples from 60 buildings, with simulator-search labels. Each arm had three proposal opportunities on the same 20 unseen factories. Final scoring used four fresh demand days per factory.

| Measure | Base | Tuned | Random legal moves |
| --- | ---: | ---: | ---: |
| Mean initial objective | 10,767.4625 | 10,767.4625 | 10,767.4625 |
| Mean final objective | 10,752.350 | 9,406.825 | 10,307.975 |
| Reduction from initial mean | 0.14% | 12.64% | 4.27% |
| Invalid proposals | 50/60 | 21/60 | 0/60 |
| Full goal on every final day | 0/20 | 0/20 | 0/20 |
| Zero damage on every final day | 0/20 | 0/20 | 0/20 |

The tuned model beat the base on 12 buildings, lost on two and tied on six. Two tuned factories regressed on final demand. The independent audit reproduced all 1,156 scenario simulations. Equal offered budgets did not produce identical actual token use or simulation counts.

These percentages are reductions in the aggregate mean objective from the starting layouts. They are not throughput gains, reductions relative to the base model, or real-world savings claims.

## Source binding

The complete reports are available in the separate `factory-n1-final` checkout and corresponding pilot branches. SHA256 hashes at this handoff:

- `nemotron-finetune-pilot.md` SHA256: `56553d78b3e7d49109984bdfbd90287a3beb12155fe27ba35c086b3cc54b1ab7`
- `nemotron-optimizer-pilot.md` SHA256: `db45206d1c54ec00c6f7bad1773ba32603a3bc2edee28a841be4fbcd9dc0d54a`
