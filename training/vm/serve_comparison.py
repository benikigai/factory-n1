"""Four immutable model arms served serially on one loopback-only GPU endpoint."""
import argparse
from contextlib import nullcontext
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import time
import uuid

from common import BASE_MODEL, BASE_REVISION, MAX_SEQUENCE_LENGTH, PROMPT_PROFILE, adapter_hashes, model_messages, save_json, validate_request

ALIASES = ("factory-optimizer-base", "factory-optimizer-v1", "factory-optimizer-old3", "factory-optimizer-v2")
CHECKPOINT = BASE_MODEL + "@" + BASE_REVISION


def inspect_checkpoint(root, expected_epochs):
    root = Path(root)
    manifest = json.loads((root / "manifest.json").read_text())
    if (manifest.get("status") != "complete" or manifest.get("baseModel") != BASE_MODEL
            or manifest.get("baseRevision") != BASE_REVISION or manifest.get("promptProfile") != PROMPT_PROFILE
            or manifest.get("taskProfile") != "optimizer" or manifest.get("smoke") is not False
            or manifest.get("epochs") != expected_epochs):
        raise ValueError("require a complete optimizer checkpoint with the prescribed epochs and pinned base")
    if adapter_hashes(root / "adapter") != manifest["adapterHashes"]:
        raise ValueError("adapter differs from training manifest")
    return {"baseCheckpoint": CHECKPOINT, "trainingJobId": manifest["trainingJobId"],
            "adapterHashes": manifest["adapterHashes"], "dataset": manifest["dataset"],
            "taskProfile": "optimizer", "promptProfile": PROMPT_PROFILE, "epochs": expected_epochs}


def request(body):
    if not isinstance(body, dict) or body.get("model") not in ALIASES:
        raise ValueError("unknown comparison model")
    canonical = {**body, "model": "factory-optimizer-base"}
    _, messages, limit = validate_request(canonical, "optimizer")
    if limit > 128:
        raise ValueError("comparison output cap is 128 tokens")
    return body["model"], messages, limit


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--v1", required=True)
    parser.add_argument("--old3", required=True)
    parser.add_argument("--v2", required=True)
    parser.add_argument("--provenance", required=True)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    roots = {ALIASES[1]: Path(args.v1), ALIASES[2]: Path(args.old3), ALIASES[3]: Path(args.v2)}
    models = {ALIASES[0]: {"baseCheckpoint": CHECKPOINT, "trainingJobId": None, "adapterHashes": None,
              "dataset": None, "taskProfile": "optimizer", "promptProfile": PROMPT_PROFILE, "epochs": 0}}
    models.update({alias: inspect_checkpoint(root, 3 if alias == ALIASES[2] else 1) for alias, root in roots.items()})
    if models[ALIASES[1]]["dataset"] != models[ALIASES[2]]["dataset"]:
        raise ValueError("old one/three-epoch conditions must use identical data")
    if models[ALIASES[1]]["dataset"] == models[ALIASES[3]]["dataset"]:
        raise ValueError("v2 data must differ from old data")
    health = {"schemaVersion": 2, "status": "ready", "baseCheckpoint": CHECKPOINT,
              "taskProfile": "optimizer", "promptProfile": PROMPT_PROFILE, "models": models}
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError("one CUDA GPU required")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, revision=BASE_REVISION, local_files_only=True, trust_remote_code=False)
    base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, revision=BASE_REVISION, local_files_only=True,
            trust_remote_code=False, torch_dtype=torch.bfloat16, attn_implementation="sdpa", device_map={"": 0})
    model = PeftModel.from_pretrained(base, roots[ALIASES[1]] / "adapter", adapter_name=ALIASES[1], is_trainable=False)
    for alias in ALIASES[2:]:
        model.load_adapter(roots[alias] / "adapter", adapter_name=alias, is_trainable=False)
    model.eval()
    model.config.use_cache = True
    save_json(args.provenance, health)

    class Handler(BaseHTTPRequestHandler):
        def send(self, status, value):
            payload = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

        def do_GET(self):
            if self.path == "/health":
                return self.send(200, health)
            if self.path == "/v1/models":
                return self.send(200, {"object": "list", "data": [{"id": a, "object": "model", "owned_by": "factory-n1"} for a in ALIASES]})
            self.send(404, {"error": {"message": "not found"}})

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                return self.send(404, {"error": {"message": "not found"}})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 2_000_000:
                    raise ValueError("invalid body size")
                alias, messages, limit = request(json.loads(self.rfile.read(length)))
                tokens = tokenizer.apply_chat_template(model_messages(messages), tokenize=True, add_generation_prompt=True, return_tensors="pt")
                prompt_length = tokens.shape[1]
                if prompt_length + limit > MAX_SEQUENCE_LENGTH:
                    raise ValueError("context limit; truncation is forbidden")
                tokens = tokens.to("cuda")
                if alias != ALIASES[0]:
                    model.set_adapter(alias)
                    model.eval()
                context = model.disable_adapter() if alias == ALIASES[0] else nullcontext()
                started = time.monotonic()
                with context, torch.inference_mode():
                    generated = model.generate(input_ids=tokens, attention_mask=torch.ones_like(tokens), max_new_tokens=limit,
                            do_sample=False, use_cache=True, pad_token_id=tokenizer.eos_token_id)
                output = generated[0, prompt_length:]
                count = len(output)
                content = tokenizer.decode(output, skip_special_tokens=True)
                self.send(200, {"id": "chatcmpl-" + uuid.uuid4().hex, "object": "chat.completion", "created": int(time.time()), "model": alias,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "length" if count >= limit else "stop"}],
                    "usage": {"prompt_tokens": prompt_length, "completion_tokens": count, "total_tokens": prompt_length + count},
                    "elapsedSeconds": round(time.monotonic() - started, 4)})
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send(400, {"error": {"message": "invalid comparison request", "type": "invalid_request_error"}})
            except Exception as error:
                print(json.dumps({"errorType": type(error).__name__}), flush=True)
                self.send(500, {"error": {"message": "inference failed", "type": "server_error"}})

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps(health), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
