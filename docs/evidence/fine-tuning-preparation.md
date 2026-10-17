# Factory critic fine-tuning preparation

The proposed student predicts factory-layout validity and outcome metrics from a single layout, fixed building constraints, simulator parameters, and four seeded package days. It is a text layout critic. It is not the visual inspector, a trained world model, or an agent that has already learned to improve factories.

## Data

`scripts/prepare-finetune.ts` generates 600 training examples from 30 new buildings, 100 validation examples from five other buildings, and 100 local held-out examples from five further buildings. All 800 layouts are unique; building identities group rotations/reflections and remain disjoint between splits. Demand seeds are disjoint too. Labels come from the unchanged simulator, including invalid, poor, zero-damage, and goal-passing examples.

The default dataset is saved in ignored `runs/finetune-data/critic-v1/`. Its manifest records hashes and source provenance. Only `train.jsonl` and `validation.jsonl` were uploaded to Crusoe on October 17, 2026. The held-out file and raw labels were not uploaded. No historical run or locked final evaluation supplies these labels.

## Live API status

The existing 1Password-backed API key successfully authenticated against `https://api.intelligence.crusoecloud.com/v1`. The catalog returned one Nemotron base model marked `fine_tuning_available: true`, named `crusoeai/NVIDIA-Nemotron-3.5-Nano-30B-A3B-BF16-07292026`. Crusoe's public fine-tuning list instead names `nvidia/nemotron-3.5-lightning-30b-a3b`.

Both dataset uploads completed and their remote byte counts matched the local files. The price-estimate request initially rejected batch size 8, so the request now pins the supported size 16. After that correction, the estimate endpoint returned HTTP 404 for the catalog registry ID, its exact model name, and the documented public model name. The latter two responses explicitly said the model was not found.

No estimate, training job, checkpoint, or hosted adapter exists yet. Preserve this distinction in the demo. Resolving the catalog/estimate mismatch and approving a training/hosting budget are required before launch.

## Operator commands

Use the existing 1Password environment. Do not copy its values into files or scripts.

- `npx tsx scripts/prepare-finetune.ts`: create a new default dataset; refuses to overwrite one.
- `node --env-file=<1Password mount> --import tsx scripts/crusoe-finetune.ts inspect`: inspect current training-capable Nemotron records.
- `node --env-file=<1Password mount> --import tsx scripts/crusoe-finetune.ts estimate --model <exact registry ID>`: reuse verified uploads and request a nonbinding estimate.
- `train` requires an approved amount, an acknowledgement that the estimate is not a hard billing cap, and the matching saved estimate. Never invent those approvals.
- `status` and `cancel` inspect or cancel a saved job. The CLI never creates a hosting endpoint.

Receipts live under `runs/finetune-data/critic-v1/crusoe/`. Pending mutation receipts block automatic retries after an unknown outcome. Training pins one epoch, rank 8, alpha 16, batch size 16, and seed 20261017.

Crusoe documents native LoRA training and dedicated Self-Serve hosting. Hosting needs a separate project-scoped hardware quote; no VM is necessary for the native training route. A model is not ready to use until its checkpoint is deployed and compared with the untuned model on the reserved test buildings.

Sources: [training workflow](https://docs.crusoecloud.com/serverless-fine-tuning/fine-tune-a-model/index.html), [supported models](https://docs.crusoecloud.com/serverless-fine-tuning/available-models/index.html), [estimate API](https://docs.crusoecloud.com/api/managed-ai/), [hosting lifecycle](https://docs.crusoecloud.com/quickstart/self-serve-deployments/index.html).
