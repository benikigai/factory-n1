import json
from pathlib import Path
import random
import tempfile
import unittest

from common import BASE_MODEL, BASE_REVISION, PROMPT_PROFILE, adapter_hashes
from serve_comparison import ALIASES, inspect_checkpoint, request
from train_comparison import training_plan


class ComparisonTests(unittest.TestCase):
    def test_three_epochs_cover_every_row_three_times_with_distinct_orders(self):
        plan = training_plan(1200, 3, 8, 450)
        self.assertEqual([len(epoch) for epoch in plan], [150, 150, 150])
        orders = [[row for batch in epoch for row in batch] for epoch in plan]
        for order in orders:
            self.assertEqual(sorted(order), list(range(1200)))
        self.assertNotEqual(orders[0], orders[1])
        self.assertNotEqual(orders[1], orders[2])
        original = list(range(1200))
        random.Random(20261017).shuffle(original)
        self.assertEqual(orders[0], original)

    def test_step_limit_rejects_a_partial_epoch(self):
        with self.assertRaises(ValueError):
            training_plan(1200, 3, 8, 449)
        with self.assertRaises(ValueError):
            training_plan(1200, 2, 8, 450)
        self.assertEqual(training_plan(2, 1, 2, 1), [[[0, 1]]])

    def test_four_aliases_share_identical_request_constraints(self):
        for alias in ALIASES:
            body = {"model": alias, "messages": [{"role": "system", "content": "x"}, {"role": "user", "content": "y"}], "max_tokens": 128}
            self.assertEqual(request(body)[0], alias)
            for extra in ({"max_tokens": 129}, {"tools": [{}]}, {"temperature": 0.1}, {"stream": True}, {"model": "other"}):
                with self.assertRaises(ValueError):
                    request({**body, **extra})

    def test_checkpoint_rejects_wrong_epoch_or_modified_weights(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "adapter").mkdir()
            (root / "adapter/adapter_config.json").write_text("{}")
            (root / "adapter/adapter_model.safetensors").write_bytes(b"weights")
            manifest = {"status": "complete", "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION,
                "promptProfile": PROMPT_PROFILE, "taskProfile": "optimizer", "smoke": False,
                "epochs": 3, "adapterHashes": adapter_hashes(root / "adapter"), "trainingJobId": "test", "dataset": {}}
            (root / "manifest.json").write_text(json.dumps(manifest))
            self.assertEqual(inspect_checkpoint(root, 3)["epochs"], 3)
            with self.assertRaises(ValueError):
                inspect_checkpoint(root, 1)
            (root / "adapter/adapter_model.safetensors").write_bytes(b"changed")
            with self.assertRaises(ValueError):
                inspect_checkpoint(root, 3)


if __name__ == "__main__":
    unittest.main()
