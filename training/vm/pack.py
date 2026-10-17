"""Prepare an ignored, train/validation-only deployment archive. Never launches compute."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
import tarfile

from common import BASE_MODEL, BASE_REVISION, load_data, save_json, sha256, validate_task_dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="runs/finetune-data/critic-v1")
    parser.add_argument("--out", help="New directory beneath runs/vm-private/")
    parser.add_argument("--task-profile", choices=("critic", "optimizer"), default="critic")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    allowed = repo / "runs" / "vm-private"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = Path(args.out).resolve() if args.out else allowed / (args.task_profile + "-" + stamp)
    if allowed not in output.parents or output.exists():
        raise ValueError("output must be a new directory beneath runs/vm-private")
    source = Path(args.data).resolve()
    validate_task_dataset(source, args.task_profile)
    rows, dataset_receipt = load_data(source)
    (output / "data").mkdir(parents=True)
    (output / "code").mkdir()
    (output / "output").mkdir()
    for name in ("manifest.json", "train.jsonl", "validation.jsonl"):
        shutil.copyfile(source / name, output / "data" / name)
    names = ("common.py", "train.py", "serve.py", "requirements.txt", "bootstrap.sh", "arm-shutdown.sh", "container-run.sh", "optimizer-run.sh", "README.md")
    for name in names:
        shutil.copyfile(Path(__file__).parent / name, output / "code" / name)
    if args.task_profile == "optimizer":
        shutil.copyfile(Path(__file__).parent / "optimizer-run.sh", output / "code" / "container-run.sh")
    save_json(output / "code" / "run-config.json", {"taskProfile": args.task_profile, "shutdownMinutes": 65 if args.task_profile == "optimizer" else 105})
    files = {str(path.relative_to(output)): sha256(path) for path in output.rglob("*") if path.is_file()}
    save_json(output / "bundle-manifest.json", {"schemaVersion": 1, "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION,
              "taskProfile": args.task_profile, "dataset": dataset_receipt, "rows": {split: len(items) for split, items in rows.items()}, "files": files,
              "excluded": ["test.jsonl", "test-factories.jsonl", "raw-labels.jsonl", "raw-transitions.jsonl", "credentials", "historical runs"]})
    archive = output.with_suffix(".tar.gz")
    if archive.exists():
        raise ValueError("archive already exists")
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(output, arcname=output.name)
    print(archive)
    print("sha256=" + sha256(archive))


if __name__ == "__main__":
    main()
