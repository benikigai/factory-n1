#!/usr/bin/env bash
set -euo pipefail
cd /workspace/code
python train_comparison.py --data /workspace/data/new --output /workspace/output/smoke --task-profile optimizer --smoke --epochs 1 --max-steps 1 --max-seconds 300
python train_comparison.py --data /workspace/data/new --output /workspace/output/v2 --task-profile optimizer --epochs 1 --max-steps 150 --max-seconds 1200
python train_comparison.py --data /workspace/data/old --output /workspace/output/old3 --task-profile optimizer --epochs 3 --max-steps 450 --max-seconds 2700
