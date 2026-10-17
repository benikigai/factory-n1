#!/usr/bin/env bash
set -euo pipefail
cd /workspace/code

python -m pip install --disable-pip-version-check -r requirements.txt
python train.py --data /workspace/data --output /workspace/output/smoke \
  --smoke --max-steps 1 --max-seconds 300 2>&1 | tee /workspace/output/smoke.log
python train.py --data /workspace/data --output /workspace/output/critic \
  --max-steps 75 --max-seconds 2400 2>&1 | tee /workspace/output/training.log
python serve.py --checkpoint /workspace/output/critic --port 8000 \
  2>&1 | tee /workspace/output/server.log
