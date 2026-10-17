# Nemotron critic training: native blocker and VM fallback

Status on October 17, 2026: preparation only. No training job or GPU VM has been created. No fine-tuned model or held-out result exists yet.

## Native service diagnosis

The request now passes schema validation with batch size 16. Crusoe accepted the train and validation uploads and reports the expected byte counts. The fine-tuning registry advertises Nemotron as trainable, but the estimate endpoint returns 404 for its exact registry ID and model name. The signed-in console reports no published training rate for that same model. Its generated API example uses the same registry ID as our client.

This is a provider registry/pricing blocker. We will not bypass the missing estimate by submitting an unpriced job. Private API receipts are retained under `runs/finetune-data/critic-v1/crusoe/`.

## Prepared fallback

The signed-in VM wizard offers one A100 80GB in `us-east1-a`. The prepared name is `factory-n1-nemotron-critic`, using the NVIDIA Docker Ubuntu image, the default network, a temporary SSH public key, and no additional disks. It is stopped at the final review step.

- Published A100 PCIe price: $2 per GPU-hour.
- Two hours of compute: $4. The automatically attached 128 GB OS disk adds approximately $0.03 for two hours if storage is prorated over a 730-hour month. This is an estimate, not a provider spending cap.
- Proposed authorization: at most $6 incremental spend, at most two hours, including training, evaluation and temporary hosting. Existing inference-test permission does not cover this allocation.
- Schedule OS shutdown at 105 minutes after startup. Verify the control plane reaches `Stopped`. Copy and verify the adapter and results before deleting the disposable VM and its OS disk.
- Keep the inference listener on loopback and access it through an SSH tunnel. Do not open a public model port.

The model is `nvidia/Llama-3.1-Nemotron-Nano-8B-v1`, revision `54641c1611fcff44fa4865626462445e0a153fc7`. This is a smaller dense Nemotron model, not the 3.5 Super VL model used by the visual inspector. The comparison will use this exact base checkpoint for both arms, with the LoRA adapter disabled or enabled.

## Frozen experiment

Train one epoch on 600 simulator-labeled examples from 30 new buildings. Use 100 validation examples from five separate buildings. The held-out set contains 100 examples from another five buildings and remains outside the training VM. The existing grader is unchanged.

Training uses rank 8, alpha 16, learning rate 0.0001, seed 20261017, microbatch one and accumulation eight, for 75 optimizer steps. Assistant tokens alone contribute to loss. Complete examples over 4096 tokens fail rather than truncate. Run a one-step GPU smoke test before the full epoch. The package combination and actual GPU runtime remain unverified until that test.

Freeze the trained adapter and provenance before the final held-out comparison. Run all 100 held-out examples, with 200 calls total, temperature zero and a 256-token output cap for both arms. The maximum token reservation is two million, with no automatic retries. Verify the local endpoint's checkpoint and training job against the saved provenance before opening the held-out data. Report schema validity, classification accuracy, false-safe predictions, numeric error and paired wins by building. This measures a layout critic's predictions, not a full optimizer's end-to-end factory performance. A lower validation loss alone is not a success claim.

After the approved training run completes and the SSH tunnel is open:

```sh
npx tsx scripts/evaluate-critic.ts --live --split test --final-eval \
  --base-model factory-critic-base --tuned-model factory-critic-lora \
  --base-url http://127.0.0.1:8000/v1 --provenance PATH_TO_PROVENANCE_JSON \
  --limit 100 --max-calls 200 --max-total-tokens 2000000 --max-output-tokens 256 \
  --out runs/finetune-eval/test-8b-v1
```

Implementation: `training/vm/`, `scripts/evaluate-critic.ts`, `src/training/evaluate.ts`. Dataset hashes and private training inputs remain in the ignored `runs/` directory.

Sources: [Crusoe pricing](https://www.crusoe.ai/cloud/pricing), [VM billing](https://docs.crusoecloud.com/compute/virtual-machines/overview/#vm-billing), [shutdown state changes](https://docs.crusoecloud.com/compute/virtual-machines/managing-vms/index.html#updating-state-from-within-the-vm), [disk lifecycle and OS disk](https://docs.crusoecloud.com/storage/disks/overview/), [NVIDIA model](https://huggingface.co/nvidia/Llama-3.1-Nemotron-Nano-8B-v1/tree/54641c1611fcff44fa4865626462445e0a153fc7).
