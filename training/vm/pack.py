"""Prepare an ignored, train/validation-only deployment archive. Never launches compute."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
import tarfile

from common import BASE_MODEL, BASE_REVISION, load_data, save_json, sha256


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="runs/finetune-data/critic-v1")
    parser.add_argument("--out", help="New directory beneath runs/vm-private/")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    allowed = repo / "runs" / "vm-private"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = Path(args.out).resolve() if args.out else allowed / ("critic-" + stamp)
    if allowed not in output.parents or output.exists():
        raise ValueError("output must be a new directory beneath runs/vm-private")
    source = Path(args.data).resolve()
    rows, dataset_receipt = load_data(source)
    (output / "data").mkdir(parents=True)
    (output / "code").mkdir()
    (output / "output").mkdir()
    for name in ("manifest.json", "train.jsonl", "validation.jsonl"):
        shutil.copyfile(source / name, output / "data" / name)
    names = ("common.py", "train.py", "serve.py", "requirements.txt", "bootstrap.sh", "arm-shutdown.sh", "container-run.sh", "README.md")
    for name in names:
        shutil.copyfile(Path(__file__).parent / name, output / "code" / name)
    files = {str(path.relative_to(output)): sha256(path) for path in output.rglob("*") if path.is_file()}
    save_json(output / "bundle-manifest.json", {"schemaVersion": 1, "baseModel": BASE_MODEL, "baseRevision": BASE_REVISION,
              "dataset": dataset_receipt, "rows": {split: len(items) for split, items in rows.items()}, "files": files,
              "excluded": ["test.jsonl", "raw-labels.jsonl", "credentials", "historical runs"]})
    archive = output.with_suffix(".tar.gz")
    if archive.exists():
        raise ValueError("archive already exists")
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(output, arcname=output.name)
    print(archive)
    print("sha256=" + sha256(archive))


if __name__ == "__main__":
    main()
