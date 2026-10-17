#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bundle_dir="$(cd -- "$script_dir/.." && pwd)"
docker run --rm --name factory-n1-v2-serve --gpus device=0 --network host --shm-size=8g \
  -e HF_HOME=/workspace/cache/huggingface \
  -v "$script_dir:/workspace/code:ro" -v "$bundle_dir/archived:/workspace/archived:ro" \
  -v "$bundle_dir/output:/workspace/output" -v "$bundle_dir/cache:/workspace/cache" \
  factory-n1-comparison python /workspace/code/serve_comparison.py \
  --v1 /workspace/archived --old3 /workspace/output/old3 --v2 /workspace/output/v2 \
  --provenance /workspace/output/comparison-provenance.json
