"""Local-only OpenAI-compatible comparison server; one immutable base checkpoint."""
import argparse
from contextlib import nullcontext
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import time
import uuid

from common import BASE_MODEL, BASE_REVISION, MAX_SEQUENCE_LENGTH, PROMPT_PROFILE, adapter_hashes, model_aliases, model_messages, validate_request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    root = Path(args.checkpoint)
    manifest = json.loads((root / "manifest.json").read_text())
    task_profile = manifest.get("taskProfile", "critic")
    base_alias, adapter_alias = model_aliases(task_profile)
    if manifest.get("status") != "complete" or manifest.get("baseModel") != BASE_MODEL or manifest.get("baseRevision") != BASE_REVISION or manifest.get("promptProfile") != PROMPT_PROFILE:
        raise ValueError("require a complete adapter on the exact pinned base model")
    if adapter_hashes(root / "adapter") != manifest["adapterHashes"]:
        raise ValueError("adapter contents differ from training manifest")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA required")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, revision=BASE_REVISION, local_files_only=True, trust_remote_code=False)
    base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, revision=BASE_REVISION, local_files_only=True,
            trust_remote_code=False, torch_dtype=torch.bfloat16, attn_implementation="sdpa", device_map={"": 0})
    model = PeftModel.from_pretrained(base, root / "adapter", is_trainable=False)
    model.eval()
    model.config.use_cache = True

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
                return self.send(200, {"status": "ready", "trainingJobId": manifest["trainingJobId"], "baseCheckpoint": BASE_MODEL + "@" + BASE_REVISION,
                    "taskProfile": task_profile, "promptProfile": PROMPT_PROFILE, "dataset": manifest["dataset"], "adapterHashes": manifest["adapterHashes"]})
            if self.path == "/v1/models":
                return self.send(200, {"object": "list", "data": [{"id": alias, "object": "model", "owned_by": "factory-n1"} for alias in (base_alias, adapter_alias)]})
            self.send(404, {"error": {"message": "not found"}})

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                return self.send(404, {"error": {"message": "not found"}})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 2_000_000:
                    raise ValueError("invalid body size")
                alias, messages, limit = validate_request(json.loads(self.rfile.read(length)), task_profile)
                tokens = tokenizer.apply_chat_template(model_messages(messages), tokenize=True, add_generation_prompt=True, return_tensors="pt")
                prompt_length = tokens.shape[1]
                if prompt_length + limit > MAX_SEQUENCE_LENGTH:
                    raise ValueError("full prompt plus output exceeds 4096 tokens; no truncation")
                tokens = tokens.to("cuda")
                # HTTPServer is deliberately single threaded: base and adapter state cannot overlap.
                context = model.disable_adapter() if alias == base_alias else nullcontext()
                with context, torch.inference_mode():
                    generated = model.generate(input_ids=tokens, attention_mask=torch.ones_like(tokens), max_new_tokens=limit,
                            do_sample=False, use_cache=True, pad_token_id=tokenizer.eos_token_id)
                output_tokens = generated[0, prompt_length:]
                content = tokenizer.decode(output_tokens, skip_special_tokens=True)
                count = len(output_tokens)
                self.send(200, {"id": "chatcmpl-" + uuid.uuid4().hex, "object": "chat.completion", "created": int(time.time()), "model": alias,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "length" if count >= limit else "stop"}],
                    "usage": {"prompt_tokens": prompt_length, "completion_tokens": count, "total_tokens": prompt_length + count}})
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send(400, {"error": {"message": "invalid request or context limit", "type": "invalid_request_error"}})
            except Exception as error:
                print(json.dumps({"errorType": type(error).__name__}), flush=True)
                self.send(500, {"error": {"message": "inference failed", "type": "server_error"}})

    # No public bind option. Use an SSH tunnel for authorized access from the demo machine.
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    server.timeout = 90
    print(json.dumps({"status": "ready", "url": f"http://127.0.0.1:{args.port}/v1", "models": [base_alias, adapter_alias]}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
