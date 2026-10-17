"""Offline validation shared by the bounded trainer and local inference server."""
import hashlib
import json
from pathlib import Path

BASE_MODEL = "nvidia/Llama-3.1-Nemotron-Nano-8B-v1"
BASE_REVISION = "54641c1611fcff44fa4865626462445e0a153fc7"
BASE_ALIAS = "factory-critic-base"
ADAPTER_ALIAS = "factory-critic-lora"
MAX_SEQUENCE_LENGTH = 4096
PROMPT_PROFILE = "nemotron8b-thinking-off-v1"


def model_aliases(task_profile="critic"):
    if task_profile not in ("critic", "optimizer"):
        raise ValueError("unknown task profile")
    return ("factory-" + task_profile + "-base", "factory-" + task_profile + "-lora")


def validate_task_dataset(directory, task_profile):
    model_aliases(task_profile)
    manifest = json.loads((Path(directory) / "manifest.json").read_text())
    if task_profile == "optimizer":
        if manifest.get("taskProfile") != "optimizer" or manifest.get("promptProfile") != "factory-single-move-optimizer-v1":
            raise ValueError("optimizer profile requires its own before/after dataset")
    elif manifest.get("taskProfile") == "optimizer":
        raise ValueError("optimizer data cannot use critic aliases")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def load_data(directory):
    """Never open the held-out file. Verify the two allowed files before parsing."""
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("schemaVersion") != 1:
        raise ValueError("unsupported dataset manifest")
    result = {}
    hashes = {}
    seen = set()
    for split in ("train", "validation"):
        name = split + ".jsonl"
        path = directory / name
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        expected = manifest["files"][name]
        if digest != expected["sha256"] or len(content) != expected["bytes"]:
            raise ValueError("dataset hash or size mismatch: " + split)
        rows = []
        for line in content.splitlines():
            row = json.loads(line)
            messages = row.get("messages")
            if not isinstance(messages, list) or [m.get("role") for m in messages] != ["system", "user", "assistant"]:
                raise ValueError("expected one system/user/assistant conversation")
            if any(not isinstance(m.get("content"), str) or not m["content"] for m in messages):
                raise ValueError("message content must be nonempty text")
            prompt_hash = hashlib.sha256(json.dumps(messages[:-1], sort_keys=True).encode()).hexdigest()
            if prompt_hash in seen:
                raise ValueError("duplicate prompt in training/validation")
            seen.add(prompt_hash)
            rows.append(messages)
        if not rows:
            raise ValueError("empty split: " + split)
        result[split] = rows
        hashes[name] = digest
    return result, {"graderHash": manifest["graderHash"], "files": hashes}


def model_messages(messages):
    """Keep the dataset immutable while applying NVIDIA's reasoning-off prompt format."""
    if not isinstance(messages, list) or len(messages) not in (2, 3):
        raise ValueError("expected canonical system/user[/assistant] messages")
    roles = [message.get("role") if isinstance(message, dict) else None for message in messages]
    if roles != ["system", "user"] + (["assistant"] if len(messages) == 3 else []):
        raise ValueError("expected canonical system/user[/assistant] messages")
    if any(not isinstance(message.get("content"), str) or not message["content"] for message in messages):
        raise ValueError("canonical content must be nonempty text")
    result = [{"role": "system", "content": "detailed thinking off"},
              {"role": "user", "content": messages[0]["content"] + "\n\n" + messages[1]["content"]}]
    if len(messages) == 3:
        result.append({"role": "assistant", "content": messages[2]["content"]})
    return result


def encode_example(tokenizer, messages, maximum=MAX_SEQUENCE_LENGTH):
    wrapped = model_messages(messages)
    if len(wrapped) != 3:
        raise ValueError("training example needs an assistant answer")
    prefix = tokenizer.apply_chat_template(wrapped[:-1], tokenize=True, add_generation_prompt=True)
    full = tokenizer.apply_chat_template(wrapped, tokenize=True, add_generation_prompt=False)
    if len(full) > maximum:
        raise ValueError(f"full example has {len(full)} tokens; limit {maximum}; truncation is forbidden")
    if full[:len(prefix)] != prefix or len(prefix) >= len(full):
        raise ValueError("chat template does not preserve the assistant boundary")
    return {"input_ids": full, "labels": [-100] * len(prefix) + full[len(prefix):]}


def adapter_hashes(directory):
    directory = Path(directory)
    names = ("adapter_config.json", "adapter_model.safetensors")
    return {name: sha256(directory / name) for name in names}


def validate_request(body, task_profile="critic"):
    if not isinstance(body, dict) or body.get("model") not in model_aliases(task_profile):
        raise ValueError("unknown model alias")
    if body.get("stream", False) is not False or body.get("temperature", 0) != 0 or body.get("tools"):
        raise ValueError("only non-streaming greedy text requests without tools are supported")
    count = body.get("max_tokens", body.get("max_completion_tokens", 256))
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 256:
        raise ValueError("max_tokens must be an integer from 1 to 256")
    messages = body.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 16:
        raise ValueError("messages must be a nonempty list")
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant") or not isinstance(message.get("content"), str):
            raise ValueError("only text system/user/assistant messages are supported")
    return body["model"], messages, count
