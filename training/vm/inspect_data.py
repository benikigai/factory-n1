"""Inspect full training conversations with the pinned tokenizer, without model weights."""
import argparse
from pathlib import Path

from common import BASE_MODEL, BASE_REVISION, MAX_SEQUENCE_LENGTH, encode_example, load_data, save_json, validate_task_dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--task-profile", choices=("critic", "optimizer"), default="optimizer")
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise ValueError("Use a new inspection output file")
    validate_task_dataset(args.data, args.task_profile)
    rows, receipt = load_data(args.data)
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, revision=BASE_REVISION, trust_remote_code=False)
    stats = {}
    for split, messages in rows.items():
        encoded = [encode_example(tokenizer, row) for row in messages]
        maximum_prompt = max(sum(label == -100 for label in row["labels"]) for row in encoded)
        if maximum_prompt + 128 > MAX_SEQUENCE_LENGTH:
            raise ValueError("Prompt has insufficient room for the frozen 128-token inference allowance")
        stats[split] = {
            "examples": len(encoded),
            "totalTokens": sum(len(row["input_ids"]) for row in encoded),
            "assistantTokens": sum(sum(label != -100 for label in row["labels"]) for row in encoded),
            "maximumTokens": max(len(row["input_ids"]) for row in encoded),
            "maximumPromptTokens": maximum_prompt,
        }
    output.parent.mkdir(parents=True, exist_ok=True)
    result = {"baseModel": BASE_MODEL, "baseRevision": BASE_REVISION, "taskProfile": args.task_profile, "dataset": receipt, "stats": stats, "modelWeightsDownloaded": False}
    save_json(output, result)
    import json
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
