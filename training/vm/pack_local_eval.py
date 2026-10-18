"""Package recovered adapters and a sealed evaluation set; never train or score."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import tarfile
from common import BASE_MODEL, BASE_REVISION, PROMPT_PROFILE, sha256
from serve_comparison import ALIASES, CHECKPOINT, inspect_checkpoint

SERVER_BASE = "pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee"


def immutable_image(value):
    if not re.fullmatch(r"[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}", value):
        raise ValueError("Pass an immutable repository@sha256 image reference")
    return value


def package(repo, data, recovered, output, node_image, job_id, eval_minutes=50):
    repo, data, output = Path(repo).resolve(), Path(data).resolve(), Path(output).resolve()
    immutable_image(node_image)
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", job_id) or not 1 <= eval_minutes <= 50:
        raise ValueError("Invalid job ID or evaluation duration")
    if output.exists():
        raise ValueError("Use a new bundle directory")
    manifest = json.loads((data / "manifest.json").read_text())
    test_record = manifest["files"]["test-factories.jsonl"]
    test_path = data / "test-factories.jsonl"
    if sha256(test_path) != test_record["sha256"] or test_path.stat().st_size != test_record["bytes"]:
        raise ValueError("Sealed test bytes do not match manifest")
    if manifest.get("taskProfile") != "optimizer" or manifest.get("promptProfile") != "factory-single-move-optimizer-v1":
        raise ValueError("Wrong dataset profile")
    models = {ALIASES[0]: {"baseCheckpoint": CHECKPOINT, "trainingJobId": None, "adapterHashes": None, "dataset": None,
                          "taskProfile": "optimizer", "promptProfile": PROMPT_PROFILE, "epochs": 0}}
    for name, alias, epochs in (("v1", ALIASES[1], 1), ("old3", ALIASES[2], 3), ("v2", ALIASES[3], 1)):
        models[alias] = inspect_checkpoint(recovered[name], epochs)
    if models[ALIASES[1]]["dataset"] != models[ALIASES[2]]["dataset"]:
        raise ValueError("Old one/three-epoch training data differ")
    if len({models[a]["trainingJobId"] for a in ALIASES[1:]}) != 3:
        raise ValueError("Adapter jobs must be distinct")
    for name, digest in models[ALIASES[3]]["dataset"]["files"].items():
        if manifest["files"][name]["sha256"] != digest:
            raise ValueError("Fresh evaluation must reference original v2 training data")
    if manifest["graderHash"] != models[ALIASES[3]]["dataset"]["graderHash"]:
        raise ValueError("Dataset grader differs from training grader")
    output.mkdir(parents=True)
    for name in ("runs/optimizer-data/v3-eval", "runs/optimizer-eval"):
        (output / name).mkdir(parents=True)
    def copy(source, relative):
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    for source in (repo / "src").rglob("*.ts"):
        copy(source, source.relative_to(repo))
    for name in ("package.json", "package-lock.json", "scripts/evaluate-optimizer-v2.ts"):
        copy(repo / name, name)
    for name in ("train.jsonl", "validation.jsonl"):
        if sha256(data / name) != manifest["files"][name]["sha256"]:
            raise ValueError("Referenced training bytes changed")
    for name in ("manifest.json", "test-factories.jsonl", "train.jsonl", "validation.jsonl"):
        copy(data / name, "data/" + name)
    for name, source in recovered.items():
        for file in ("manifest.json", "adapter/adapter_config.json", "adapter/adapter_model.safetensors"):
            copy(Path(source) / file, "models/" + name + "/" + file)
    for name in ("common.py", "serve_comparison.py", "requirements.txt", "local_eval.py", "local-eval-entry.sh"):
        copy(repo / "training/vm" / name, "vm/" + name)
    expected = {"schemaVersion": 2, "status": "ready", "baseCheckpoint": CHECKPOINT,
                "taskProfile": "optimizer", "promptProfile": PROMPT_PROFILE, "models": models}
    (output / "expected-health.json").write_text(json.dumps(expected, indent=2) + "\n")
    (output / "server.Dockerfile").write_text("FROM " + SERVER_BASE + "\nCOPY vm/requirements.txt /tmp/requirements.txt\nRUN pip install --no-cache-dir -r /tmp/requirements.txt\n")
    (output / "node.Dockerfile").write_text("FROM " + node_image + "\nWORKDIR /Users/bshyong/Code\nCOPY package.json package-lock.json ./\nRUN npm ci --ignore-scripts --no-audit --no-fund\n")
    (output / ".dockerignore").write_text("models\ndata\nsrc\nscripts\ncache\noutput\nartifacts\nvm/*\n!vm/requirements.txt\n")
    config = {"schemaVersion": 1, "budgetUsd": 3, "jobId": job_id, "evaluationMinutes": eval_minutes, "maxVmMinutes": 85, "workstopMinutes": 75, "setupMinutes": 20,
              "serverBase": SERVER_BASE, "nodeBase": node_image, "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION,
              "training": False, "factories": 20, "proposalsPerFactory": 12, "maxCalls": 960, "maxTokensPerArm": 4000000,
              "maxSimulationsPerArm": 1280, "requestRetries": 0, "maxOutputTokens": 128}
    (output / "job-config.json").write_text(json.dumps(config, indent=2) + "\n")
    files = {str(p.relative_to(output)): sha256(p) for p in output.rglob("*") if p.is_file()}
    (output / "bundle-manifest.json").write_text(json.dumps({"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "purpose": "Recovered four-arm inference evaluation only; no training or scoring during packaging", "files": files}, indent=2) + "\n")
    archive = output.with_suffix(".tar.gz")
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(output, arcname=output.name)
    return {"archive": str(archive), "sha256": sha256(archive), "bytes": archive.stat().st_size,
            "bundleManifestSha256": sha256(output / "bundle-manifest.json"), "testSha256": test_record["sha256"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--data", required=True)
    parser.add_argument("--v1", required=True)
    parser.add_argument("--old3", required=True)
    parser.add_argument("--v2", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--node-image", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--eval-minutes", type=int, default=50)
    args = parser.parse_args()
    print(json.dumps(package(args.repo, args.data, {name: getattr(args, name) for name in ("v1", "old3", "v2")},
                             args.out, args.node_image, args.job_id, args.eval_minutes), indent=2))

if __name__ == "__main__":
    main()
