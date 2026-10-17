#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bundle_dir="$(cd -- "$script_dir/.." && pwd)"
if [[ ! -f "$bundle_dir/bundle-manifest.json" || ! -f "$bundle_dir/data/train.jsonl" || ! -f "$bundle_dir/data/validation.jsonl" ]]; then
  echo 'Run this script from an extracted pack.py bundle.' >&2
  exit 1
fi
if [[ -e "$bundle_dir/data/test.jsonl" || -e "$bundle_dir/data/test-factories.jsonl" || -e "$bundle_dir/data/raw-transitions.jsonl" ]]; then
  echo 'Held-out data must not be copied to the training VM.' >&2
  exit 1
fi
command -v docker >/dev/null
docker info >/dev/null
shutdown_minutes="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["shutdownMinutes"])' "$script_dir/run-config.json")"
bash "$script_dir/arm-shutdown.sh" "$shutdown_minutes"
mkdir -p "$bundle_dir/output" "$bundle_dir/cache"

# Host networking preserves the server's loopback-only bind for the SSH tunnel.
docker run --rm --name factory-n1-critic --gpus device=0 --network host \
  --shm-size=8g \
  -e HF_HOME=/workspace/cache/huggingface \
  -v "$script_dir:/workspace/code:ro" \
  -v "$bundle_dir/data:/workspace/data:ro" \
  -v "$bundle_dir/output:/workspace/output" \
  -v "$bundle_dir/cache:/workspace/cache" \
  pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime \
  bash /workspace/code/container-run.sh
