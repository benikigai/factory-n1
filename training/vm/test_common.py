import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from common import BASE_ALIAS, encode_example, load_data, model_messages, validate_request

CONVERSATION = [{"role": "system", "content": "instructions"}, {"role": "user", "content": "question"}, {"role": "assistant", "content": "answer"}]


class Tokenizer:
    def apply_chat_template(self, messages, tokenize, add_generation_prompt):
        return [1, 2, 3] if add_generation_prompt else [1, 2, 3, 4, 5]


class ValidationTests(unittest.TestCase):
    def test_only_assistant_tokens_have_loss(self):
        self.assertEqual(encode_example(Tokenizer(), CONVERSATION)["labels"], [-100, -100, -100, 4, 5])
        with self.assertRaises(ValueError):
            encode_example(Tokenizer(), CONVERSATION, maximum=4)

    def test_boundary_mismatch_fails_closed(self):
        class Wrong(Tokenizer):
            def apply_chat_template(self, messages, tokenize, add_generation_prompt):
                return [9] if add_generation_prompt else [1, 2, 3]
        with self.assertRaises(ValueError):
            encode_example(Wrong(), CONVERSATION)

    def test_train_and_inference_share_reasoning_off_wrapper_without_mutation(self):
        original = json.loads(json.dumps(CONVERSATION))
        train = model_messages(CONVERSATION)
        inference = model_messages(CONVERSATION[:-1])
        self.assertEqual(train[:-1], inference)
        self.assertEqual(train[0], {"role": "system", "content": "detailed thinking off"})
        self.assertEqual(train[1]["content"], "instructions\n\nquestion")
        self.assertEqual(train[-1], CONVERSATION[-1])
        self.assertEqual(CONVERSATION, original)
        for invalid in ([], CONVERSATION[1:], [CONVERSATION[1], CONVERSATION[0]], CONVERSATION + [CONVERSATION[2]]):
            with self.assertRaises(ValueError):
                model_messages(invalid)

    def test_request_limits(self):
        request = {"model": BASE_ALIAS, "messages": [{"role": "user", "content": "x"}], "temperature": 0, "max_tokens": 256}
        self.assertEqual(validate_request(request)[2], 256)
        for override in ({"model": "other"}, {"temperature": 0.1}, {"max_tokens": True}, {"max_tokens": 257}, {"stream": True}, {"messages": [{"role": "user", "content": []}]}):
            with self.assertRaises(ValueError):
                validate_request({**request, **override})

    def test_loads_only_hash_verified_development_files(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            manifest = {"schemaVersion": 1, "graderHash": "frozen", "files": {}}
            for split in ("train", "validation"):
                row = {"messages": [{"role": "system", "content": "system"}, {"role": "user", "content": split}, {"role": "assistant", "content": "answer"}]}
                data = (json.dumps(row) + "\n").encode()
                (root / (split + ".jsonl")).write_bytes(data)
                manifest["files"][split + ".jsonl"] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            (root / "manifest.json").write_text(json.dumps(manifest))
            # There is deliberately no held-out file here.
            self.assertEqual(len(load_data(root)[0]["train"]), 1)
            (root / "train.jsonl").write_text("changed")
            with self.assertRaises(ValueError):
                load_data(root)


if __name__ == "__main__":
    unittest.main()
