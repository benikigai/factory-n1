import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import local_eval as runner
from pack_local_eval import immutable_image, package
from common import BASE_MODEL, BASE_REVISION, PROMPT_PROFILE, adapter_hashes


class LocalEvaluationTests(unittest.TestCase):
    def fixture(self, root):
        config = {"budgetUsd": 3, "jobId": "offline-test", "maxVmMinutes": 85, "workstopMinutes": 75, "setupMinutes": 20,
                  "evaluationMinutes": 50, "training": False}
        (root / "job-config.json").write_text(json.dumps(config))
        (root / "vm").mkdir()
        (root / "vm/local_eval.py").write_text("# fixture, never executed\n")
        files = {str(p.relative_to(root)): runner.sha(p) for p in root.rglob("*") if p.is_file()}
        (root / "bundle-manifest.json").write_text(json.dumps({"files": files}))
        return config

    def test_deadline_never_extends_past_original_workstop(self):
        self.assertEqual(runner.remaining_budget(1000, 5500, 1100), 4400)
        for values in ((1000, 5501, 1100), (1000, 1220, 1100), (1200, 5500, 1100)):
            with self.assertRaises(ValueError):
                runner.remaining_budget(*values)

    def test_checksum_guard_rejects_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            runner.verify(root)
            (root / "vm/local_eval.py").write_text("changed")
            with self.assertRaisesRegex(ValueError, "Bundle mismatch"):
                runner.verify(root)

    def test_container_pair_uses_loopback_and_preserves_canonical_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.fixture(root)
            server = runner.container_command(root, config, "server")
            evaluator = runner.container_command(root, config, "evaluator")
            for args in (server, evaluator):
                self.assertEqual(args[args.index("--network") + 1], "host")
                self.assertNotIn("-p", args)
                self.assertIn("--read-only", args)
            self.assertIn("HF_HUB_OFFLINE=1", server)
            self.assertIn("--gpus", server)
            self.assertNotIn("--gpus", evaluator)
            self.assertIn(str(root.resolve() / "output/evaluation") + ":/Users/bshyong/Code/factory-n1-final/runs/optimizer-eval", evaluator)
            self.assertIn("/Users/bshyong/Code/factory-n1-final", evaluator)

    def test_systemd_owns_both_containers_without_restart_or_ssh_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.fixture(root)
            calls = []
            with patch.object(runner, "command", side_effect=lambda args, **kwargs: calls.append(args)):
                for kind in ("server", "evaluator"):
                    runner.start_unit(root, config, kind, runner.container_command(root, config, kind), 3000)
            for args in calls:
                self.assertEqual(args[0], "systemd-run")
                self.assertIn("--property=Restart=no", args)
                self.assertIn("--property=RuntimeMaxSec=3000", args)
                self.assertTrue(any(str(arg).startswith("--property=ExecStopPost=-/usr/bin/docker rm -f") for arg in args))
                self.assertNotIn("ssh", args)

    def test_poweroff_timer_is_armed_before_supervisor_and_launch_requires_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            calls = []
            with patch.object(runner.os, "geteuid", return_value=0), patch.object(runner.time, "time", return_value=1100), patch.object(runner, "command", side_effect=lambda args, **kwargs: calls.append(args)):
                with self.assertRaisesRegex(ValueError, "approve"):
                    runner.launch(root, 1000, 5500, False)
                self.assertEqual(calls, [])
                runner.launch(root, 1000, 5500, True)
                self.assertIn("/sbin/shutdown", calls[0])
                self.assertIn("--on-calendar=1970-01-01 01:31:40 UTC", calls[0])
                self.assertIn("finalize", calls[1])
                self.assertIn("supervise", calls[2])
                with self.assertRaisesRegex(ValueError, "already launched"):
                    runner.launch(root, 1000, 5500, True)

    def test_evaluation_duration_cannot_exceed_fifty_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.fixture(root)
            for minutes in (51, 60):
                config["evaluationMinutes"] = minutes
                path = root / "job-config.json"
                path.write_text(json.dumps(config))
                manifest = json.loads((root / "bundle-manifest.json").read_text())
                manifest["files"]["job-config.json"] = runner.sha(path)
                (root / "bundle-manifest.json").write_text(json.dumps(manifest))
                with self.assertRaisesRegex(ValueError, "scope"):
                    runner.verify(root)

    def test_cleanup_timeout_does_not_skip_other_containers(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.fixture(root)
            calls = []
            def fail(args, **kwargs):
                calls.append(args)
                raise subprocess.TimeoutExpired(args, 5)
            with patch.object(runner, "command", side_effect=fail):
                errors = runner.units_stop(root, config, include_supervisor=True)
            self.assertEqual(len(calls), 6)
            self.assertEqual(len(errors), 6)
            self.assertTrue(any("-server" in str(arg) for arg in calls[-1]))

    def test_image_tags_cannot_float(self):
        self.assertEqual(immutable_image("node@sha256:" + "a" * 64), "node@sha256:" + "a" * 64)
        with self.assertRaises(ValueError):
            immutable_image("node:latest")

    def test_package_preserves_nested_mountpoints_and_does_not_parse_sealed_cases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, data = root / "repo", root / "data"
            (repo / "src").mkdir(parents=True)
            (repo / "src/stub.ts").write_text("export const stub = true;\n")
            (repo / "scripts").mkdir()
            (repo / "scripts/evaluate-optimizer-v2.ts").write_text("// fixture\n")
            for name in ("package.json", "package-lock.json"):
                (repo / name).write_text("{}\n")
            (repo / "training/vm").mkdir(parents=True)
            for name in ("common.py", "serve_comparison.py", "requirements.txt", "local_eval.py", "local-eval-entry.sh"):
                (repo / "training/vm" / name).write_text("fixture\n")
            data.mkdir()
            for name in ("train.jsonl", "validation.jsonl", "test-factories.jsonl"):
                (data / name).write_text("sealed unparsed bytes " + name)
            files = {name: {"sha256": runner.sha(data / name), "bytes": (data / name).stat().st_size}
                     for name in ("train.jsonl", "validation.jsonl", "test-factories.jsonl")}
            dataset = {"graderHash": "a" * 64, "files": {name: files[name]["sha256"] for name in ("train.jsonl", "validation.jsonl")}}
            (data / "manifest.json").write_text(json.dumps({"taskProfile": "optimizer", "promptProfile": "factory-single-move-optimizer-v1", "graderHash": "a" * 64, "files": files}))
            recovered = {}
            for name, epochs in (("v1", 1), ("old3", 3), ("v2", 1)):
                path = root / name
                (path / "adapter").mkdir(parents=True)
                (path / "adapter/adapter_config.json").write_text("{}")
                (path / "adapter/adapter_model.safetensors").write_text(name)
                old = {"graderHash": "a" * 64, "files": {"train.jsonl": "b" * 64, "validation.jsonl": "c" * 64}}
                (path / "manifest.json").write_text(json.dumps({"status": "complete", "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION,
                    "promptProfile": PROMPT_PROFILE, "taskProfile": "optimizer", "smoke": False, "epochs": epochs,
                    "trainingJobId": name, "adapterHashes": adapter_hashes(path / "adapter"), "dataset": dataset if name == "v2" else old}))
                recovered[name] = path
            output = root / "bundle"
            receipt = package(repo, data, recovered, output, "node@sha256:" + "d" * 64, "test-package")
            self.assertTrue((output / "runs/optimizer-data/v3-eval").is_dir())
            self.assertTrue((output / "runs/optimizer-eval").is_dir())
            self.assertEqual(runner.sha(output / "data/test-factories.jsonl"), files["test-factories.jsonl"]["sha256"])
            self.assertEqual(json.loads((output / "job-config.json").read_text())["budgetUsd"], 3)
            self.assertTrue(Path(receipt["archive"]).is_file())

    def test_sealed_output_contains_checkpoint_and_unknown_receipt_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.fixture(root)
            output = root / "output/evaluation/v3-vm/requests"
            output.mkdir(parents=True)
            original = '{"id":"unknown-1","status":"unknown","reservedTokens":8000}\n'
            (output / "unknown-1.json").write_text(original)
            with patch.object(runner, "command", return_value=SimpleNamespace(stdout="Result=success\n")):
                runner.seal(root, config)
            manifest = json.loads((root / "output/artifact-manifest.json").read_text())
            self.assertEqual(manifest["files"]["evaluation/v3-vm/requests/unknown-1.json"], runner.sha(output / "unknown-1.json"))
            self.assertEqual((output / "unknown-1.json").read_text(), original)
            self.assertEqual(len(list((root / "artifacts").glob("*.tar.gz"))), 1)


if __name__ == "__main__":
    unittest.main()
