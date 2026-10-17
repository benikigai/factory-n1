#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bundle_dir="$(cd -- "$script_dir/.." && pwd)"
stop_epoch="${1:?Pass the fixed shutdown epoch, creation plus 90 minutes}"
now_epoch="$(date +%s)"
seconds_remaining="$((stop_epoch-now_epoch))"
if (( seconds_remaining < 60 || seconds_remaining > 5400 )); then
  echo 'Shutdown must be within the original 90-minute work window.' >&2
  exit 1
fi
if ! systemctl is-active --quiet factory-n1-v2-hard-stop.timer; then
  sudo systemd-run --unit=factory-n1-v2-hard-stop --on-active="${seconds_remaining}s" \
    --timer-property=AccuracySec=1s /sbin/shutdown -h now
fi
systemctl list-timers --all --no-pager factory-n1-v2-hard-stop.timer
python3 - "$bundle_dir" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
manifest=json.loads((root/'bundle-manifest.json').read_text())
for name,digest in manifest['files'].items():
    if hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest:
        raise ValueError('bundle checksum mismatch: '+name)
if any(p.name in ('test.jsonl','test-factories.jsonl','raw-transitions.jsonl') for p in root.rglob('*')):
    raise ValueError('held-out/raw data in training bundle')
PY
mkdir -p "$bundle_dir/output" "$bundle_dir/cache"
docker build -t factory-n1-comparison -f- "$script_dir" <<'DOCKER'
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime
COPY requirements.txt /tmp/factory-requirements.txt
RUN pip install --no-cache-dir -r /tmp/factory-requirements.txt
DOCKER
docker run --rm --name factory-n1-v2-train --gpus device=0 --network host --shm-size=8g \
  -e HF_HOME=/workspace/cache/huggingface \
  -v "$script_dir:/workspace/code:ro" -v "$bundle_dir/data:/workspace/data:ro" \
  -v "$bundle_dir/output:/workspace/output" -v "$bundle_dir/cache:/workspace/cache" \
  factory-n1-comparison bash /workspace/code/comparison-train.sh
# A fresh container avoids reusing CUDA process state after the training jobs.
bash "$script_dir/comparison-serve.sh"
