"""Freeze only training data, verified archived adapter, and code for the approved pilot."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
import tarfile

from common import BASE_MODEL, BASE_REVISION, load_data, save_json, sha256, validate_task_dataset
from serve_comparison import inspect_checkpoint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-data", default="runs/optimizer-data/v1")
    parser.add_argument("--new-data", default="runs/optimizer-data/v2")
    parser.add_argument("--v1", default="runs/optimizer-recovery/optimizer")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    output = repo / "runs/optimizer-v2-private" / datetime.now(timezone.utc).strftime("bundle-%Y%m%dT%H%M%SZ")
    output.mkdir(parents=True, exist_ok=False)
    receipts = {}
    for label, source in (("old", Path(args.old_data)), ("new", Path(args.new_data))):
        validate_task_dataset(source, "optimizer")
        rows, receipt = load_data(source)
        if len(rows["train"]) != 1200 or len(rows["validation"]) != 200:
            raise ValueError("comparison requires 1200 train and 200 validation rows per dataset")
        receipts[label] = receipt
        dest = output / "data" / label
        dest.mkdir(parents=True)
        for name in ("manifest.json", "train.jsonl", "validation.jsonl"):
            shutil.copyfile(source / name, dest / name)
    archived = Path(args.v1)
    v1 = inspect_checkpoint(archived, 1)
    if v1["dataset"] != receipts["old"]:
        raise ValueError("archived model was not trained on the old dataset")
    (output / "archived" / "adapter").mkdir(parents=True)
    shutil.copyfile(archived / "manifest.json", output / "archived" / "manifest.json")
    for name in ("adapter_config.json", "adapter_model.safetensors"):
        shutil.copyfile(archived / "adapter" / name, output / "archived" / "adapter" / name)
    (output / "code").mkdir()
    for name in ("common.py", "train_comparison.py", "serve_comparison.py", "requirements.txt", "comparison-bootstrap.sh", "comparison-train.sh", "comparison-serve.sh"):
        shutil.copyfile(Path(__file__).parent / name, output / "code" / name)
    files = {str(path.relative_to(output)): sha256(path) for path in output.rglob("*") if path.is_file()}
    save_json(output / "bundle-manifest.json", {"schemaVersion": 1, "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION,
              "datasets": receipts, "archivedModel": v1, "files": files, "limitUsd": 4, "limitMinutes": 100,
              "excluded": ["test.jsonl", "test-factories.jsonl", "raw-transitions.jsonl", "credentials", "held-out scores"]})
    archive = output.with_suffix(".tar.gz")
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(output, arcname=output.name)
    print(archive)
    print("sha256=" + sha256(archive))


if __name__ == "__main__":
    main()
