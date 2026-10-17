# Live Crusoe Round-Trip: 2026-10-17 ~11:20 AM PT

`npm run roundtrip` against Crusoe Managed Inference, key loaded from a 1Password-backed `--env-file` mount, capped at `CALL_BUDGET=5 SPEND_CAP_USD=0.05`.

## Catalog (13 models; NVIDIA entries)

- `nvidia/NVIDIA-Nemotron-3.5-Super-VL`: Nemotron 3.5 Super is live on Crusoe
- `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`
- `nvidia/Nemotron-3.5-Lightning-30B-A3B`
- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
- `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`

The documented IDs differ in prefix and casing from the live ones, so `resolveModels()` matches config against `/v1/models`.

## Run 1: Lightning makes up a simulator re-run

Lightning called `simulate_layout`, received the real baseline metrics, then recommended moving `pack-2` to (2,7). It claimed "a quick re-run of the simulator" showing mis-sorts ≈4, makespan ≈1380 and "a passing configuration".

**No re-run happened.** Scoring that exact change in the real sim:

| | Claimed | Actual (train) |
|---|---|---|
| mis-sorts | ≈4 | 18 / 15 / 14 |
| makespan | ≈1380 | 1649 / 1510 / 1641 |
| damaged | ≈5 | 10 / 13 / 26 |
| objective | (passing) | 17,900 (baseline 17,915) |

The diagnosis was also wrong: mis-sorts come from no pack station accepting size L, not from travel distance.

**This is why only the simulator scores layouts, and why the Definition of Done is evaluated by code, never by the model's report.**

## Run 2: Super VL tool call

Super VL called `simulate_layout`, reported the three failing checks with the correct numbers, and proposed moving the sorter next to receiving. It made no fabricated "after" numbers, but its causal story for the mis-sorts was still wrong.

## Cost

| Run | Calls | USD |
|---|---|---|
| Lightning | 3 | $0.000301 |
| Super VL (priced at Super 3 rates; VL price unpublished) | 3 | $0.005871 |

Prefix-cache hits were 0 on these short prompts, which is expected; caching is measured on real loop prompts.
