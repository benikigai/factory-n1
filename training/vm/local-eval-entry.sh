#!/usr/bin/env bash
set -euo pipefail
cd /Users/bshyong/Code/factory-n1-final
out=/Users/bshyong/Code/factory-n1-final/runs/optimizer-eval/v3-vm
# A durable unknown receipt must fail closed in the unchanged evaluator.
if [[ -f "$out/evaluation-plan.json" ]]; then
  exec node --import tsx scripts/evaluate-optimizer-v2.ts --resume "$out" --live --final-eval
fi
exec node --import tsx scripts/evaluate-optimizer-v2.ts \
  --live --final-eval --data /Users/bshyong/Code/factory-n1-final/runs/optimizer-data/v3-eval --out "$out" \
  --base-url http://127.0.0.1:8000/v1 --provenance /Users/bshyong/Code/factory-n1-final/expected-health.json \
  --factories 20 --max-calls 960 --max-tokens-per-arm 4000000 \
  --max-simulations-per-arm 1280 --max-runtime-minutes "$FACTORY_EVAL_MINUTES" \
  --random-seed 202610174
