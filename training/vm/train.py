"""One-epoch LoRA training. Run only on the explicitly approved GPU VM."""
import argparse
import json
import math
from pathlib import Path
import random
import shutil
import time
import uuid

from common import BASE_MODEL, BASE_REVISION, PROMPT_PROFILE, adapter_hashes, encode_example, load_data, model_aliases, save_json, validate_task_dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--task-profile", choices=("critic", "optimizer"), default="critic")
    parser.add_argument("--smoke", action="store_true", help="Two training rows, one validation row and one optimizer step")
    parser.add_argument("--validate-only", action="store_true", help="Check dataset hashes with stdlib only; no downloads")
    parser.add_argument("--max-steps", type=int, default=75)
    parser.add_argument("--max-seconds", type=int, default=2400)
    args = parser.parse_args()
    if not 1 <= args.max_steps <= 512 or not 60 <= args.max_seconds <= 5400:
        raise ValueError("max-steps must be 1..512; max-seconds must be 60..5400")
    validate_task_dataset(args.data, args.task_profile)
    rows, data_receipt = load_data(args.data)
    base_alias, adapter_alias = model_aliases(args.task_profile)
    if args.validate_only:
        print(json.dumps({"verified": data_receipt, "rows": {s: len(r) for s, r in rows.items()}}))
        return
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    deadline = started + args.max_seconds
    run_id = "vm-" + args.task_profile + "-" + uuid.uuid4().hex
    receipt = {"schemaVersion": 1, "trainingJobId": run_id, "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION, "promptProfile": PROMPT_PROFILE,
               "dataset": data_receipt, "smoke": args.smoke, "epochs": 1, "rank": 8, "alpha": 16, "seed": 20261017,
               "status": "preparing", "taskProfile": args.task_profile, "optimizerSteps": 0, "maxSeconds": args.max_seconds, "maxSteps": args.max_steps}
    save_json(output / "manifest.json", receipt)
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import LoraConfig, TaskType, get_peft_model

        if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
            raise RuntimeError("exactly one CUDA GPU is required")
        device = torch.cuda.get_device_properties(0)
        if device.total_memory < 70 * 1024 ** 3 or not torch.cuda.is_bf16_supported():
            raise RuntimeError("this approved recipe requires one BF16-capable 80 GB GPU")
        if shutil.disk_usage(output).free < 35 * 1024 ** 3:
            raise RuntimeError("at least 35 GiB free disk required for base model and adapter")
        torch.manual_seed(20261017)
        random.seed(20261017)
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, revision=BASE_REVISION, trust_remote_code=False)
        # Validate every full row before any training; smoke only limits the examples used.
        encoded = {split: [encode_example(tokenizer, messages) for messages in split_rows] for split, split_rows in rows.items()}
        receipt["tokenLengths"] = {split: {"rows": len(items), "maximum": max(len(x["input_ids"]) for x in items),
                                  "total": sum(len(x["input_ids"]) for x in items)} for split, items in encoded.items()}
        train_rows = encoded["train"][:2] if args.smoke else encoded["train"]
        validation = encoded["validation"][:1] if args.smoke else encoded["validation"]
        accumulation = 2 if args.smoke else 8
        required_steps = math.ceil(len(train_rows) / accumulation)
        if required_steps > args.max_steps:
            raise ValueError(f"one complete epoch requires {required_steps} steps, above max-steps")
        model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, revision=BASE_REVISION, trust_remote_code=False,
                    torch_dtype=torch.bfloat16, attn_implementation="sdpa", device_map={"": 0})
        model.config.use_cache = False
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model = get_peft_model(model, LoraConfig(task_type=TaskType.CAUSAL_LM, r=8, lora_alpha=16,
                    lora_dropout=0.0, bias="none", target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]))
        model.enable_input_require_grads()
        parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
        if not parameters or any(parameter.requires_grad for name, parameter in model.named_parameters() if "lora_" not in name):
            raise RuntimeError("only LoRA parameters may train")
        receipt["trainableParameters"] = sum(parameter.numel() for parameter in parameters)
        receipt["gpu"] = {"name": device.name, "memoryBytes": device.total_memory}
        optimizer = torch.optim.AdamW(parameters, lr=1e-4, weight_decay=0.0)

        def deadline_check():
            if time.monotonic() >= deadline:
                raise TimeoutError("training runtime ceiling reached")

        def tensors(row):
            ids = torch.tensor([row["input_ids"]], device="cuda", dtype=torch.long)
            return {"input_ids": ids, "attention_mask": torch.ones_like(ids),
                    "labels": torch.tensor([row["labels"]], device="cuda", dtype=torch.long)}

        def validation_loss():
            model.eval()
            numerator = denominator = 0
            with torch.no_grad():
                for row in validation:
                    deadline_check()
                    tokens = sum(label != -100 for label in row["labels"][1:])
                    loss = model(**tensors(row)).loss.item()
                    if not math.isfinite(loss):
                        raise RuntimeError("nonfinite validation loss")
                    numerator += loss * tokens
                    denominator += tokens
            return numerator / denominator

        receipt["beforeValidationLoss"] = validation_loss()
        order = list(range(len(train_rows)))
        random.shuffle(order)
        model.train()
        for offset in range(0, len(order), accumulation):
            deadline_check()
            group = order[offset:offset + accumulation]
            optimizer.zero_grad(set_to_none=True)
            group_loss = 0.0
            for index in group:
                deadline_check()
                loss = model(**tensors(train_rows[index])).loss
                if not torch.isfinite(loss):
                    raise RuntimeError("nonfinite training loss")
                group_loss += loss.item()
                (loss / len(group)).backward()
            torch.nn.utils.clip_grad_norm_(parameters, 1.0)
            optimizer.step()
            receipt["optimizerSteps"] += 1
            receipt["status"] = "training"
            save_json(output / "manifest.json", receipt)
            print(json.dumps({"step": receipt["optimizerSteps"], "loss": group_loss / len(group)}), flush=True)
        receipt["afterValidationLoss"] = validation_loss()
        deadline_check()
        model.save_pretrained(output / "adapter", safe_serialization=True)
        receipt["adapterHashes"] = adapter_hashes(output / "adapter")
        receipt["status"] = "complete"
        receipt["elapsedSeconds"] = round(time.monotonic() - started, 3)
        receipt["peakGpuMemoryBytes"] = torch.cuda.max_memory_allocated()
        save_json(output / "manifest.json", receipt)
        checkpoint = BASE_MODEL + "@" + BASE_REVISION
        save_json(output / "provenance.json", {"baseModel": base_alias, "tunedModel": adapter_alias,
                    "baseCheckpoint": checkpoint, "tunedBaseCheckpoint": checkpoint, "trainingJobId": run_id,
                    "taskProfile": args.task_profile, "promptProfile": PROMPT_PROFILE,
                    "dataset": data_receipt, "adapterHashes": receipt["adapterHashes"]})
        print(json.dumps({"status": "complete", "trainingJobId": run_id, "beforeValidationLoss": receipt["beforeValidationLoss"], "afterValidationLoss": receipt["afterValidationLoss"]}))
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["failureType"] = type(error).__name__
        receipt["elapsedSeconds"] = round(time.monotonic() - started, 3)
        save_json(output / "manifest.json", receipt)
        raise


if __name__ == "__main__":
    main()
