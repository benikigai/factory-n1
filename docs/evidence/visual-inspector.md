# Nemotron visual inspector

Recorded on October 17, 2026 using `nvidia/NVIDIA-Nemotron-3.5-Super-VL` through Crusoe Managed Inference. This is a post-run inspection of the existing `live-a-11` baseline and champion, not the optimization that created them.

## Verified

- Sent a JPEG captured from the actual 3D replay at 600 simulated seconds. The screenshot contained an unpredictable six-character marker absent from system/user text and tool results. The model returned the exact marker, verifying image ingestion through Crusoe.
- The model requested five read-only tools: two layout reads, one select-day comparison, and two route measurements.
- Re-executed all five tools independently. Every returned result matched the recorded receipt exactly.
- The reported validation objective, 18061.11 to 3283.44, matched the comparison receipt. Other visual interpretations are not automatically treated as proven causal explanations.
- Three model requests cost $0.00166222 at the recorded token rates, with no uncertain-charge reservations.
- Grader SHA-256 stayed `493a1b033888446449637b8872016ad40f552f2608a6a3ddb3da66d499ad9cc4`. No final split was opened by the inspector.

## Review and reproduce

Open `replay.html?run=live-a-11&view=visual`. The screenshot, original model findings, exact tool inputs/outputs, image-input receipt and training record are linked there. This is recorded evidence, so opening the static demo makes no paid requests.

Run `npx tsx scripts/verify-visual-inspection.ts` for offline verification. Run `npm test`, `npm run typecheck`, `npx tsc --project web/tsconfig.json --noEmit`, and `npm run build:static` for the complete checks.

A new live inspection uses `scripts/visual-inspect.ts` with the existing 1Password environment. The script requires explicit caps no higher than `CALL_BUDGET=4 SPEND_CAP_USD=0.11`, refuses an already-attempted output directory, saves spend before dispatch, and never retries automatically. Do not restart it or remove its spend file without reconciling previous requests.

## Training data

The complete prompt, image, model replies, tool schemas, arguments, results and costs are retained under ignored `runs/live-a-11/inspection/`. A reviewed public training record references the JPEG by relative path; it contains no credentials. These records are uncurated development data, not an evaluated fine-tuned model. Keep this inspected run out of future evaluation sets.
