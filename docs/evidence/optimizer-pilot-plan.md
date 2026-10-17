# Nemotron optimizer pilot

Status: dataset and offline implementation prepared on `codex/optimizer-pilot`. No second GPU VM has been created and no optimizer training or live comparison has run. New paid execution requires approval of the estimate below.

This experiment is separate from the frozen website and video. The previous critic adapter remains a separate artifact. Start from the same pinned base model, not the critic adapter.

## Task and data

Train `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` at revision `54641c1611fcff44fa4865626462445e0a153fc7` to propose one machine relocation. Its input is the current layout, building constraints and measured simulator feedback. Its output is one move, or an explicit stop. It cannot move docks, change the building, add machines, change routing, or change the grader.

The prepared dataset has 1,200 training examples from 60 generated buildings and 200 validation examples from 10 other buildings. A separate 20 buildings are reserved for the final paired optimization comparison. Split buildings are disjoint under rotation and reflection and exclude the earlier critic buildings and canonical demonstration factories.

Local generation took 56.295 seconds and 321,452 scenario simulations. The 1,400 supervised examples contain 1,387 improving moves and 13 genuine stop labels. Trajectory positions are 563 first, 474 second and 363 third steps. The 20 test factories have not been scored. Data and full transition receipts remain in ignored `runs/optimizer-data/v1/`.

Training file SHA256: `39622e2529c53607ec890c587d2faa0ab41b2bd40b5048c8148e53725a9f6895`. Validation file SHA256: `11e7d2c849d50112af9fb7d986c704516c9c75e6c74ee6fc00eb34e2d4dac52c`. Test-factory file SHA256: `ee7346e6123a15ae5880533a5aaccf61e1e7934cd51a482ddbc9913ffcd066c1`.

Every stored transition includes the complete before layout, chosen action, complete after layout, hashes, and measured before/after outcomes. A bounded search chooses a candidate using four feedback demand days. The single selected candidate must also improve on four independent gate days without regressing a previously passed goal check. Include later states in three-step trajectories. Stop examples mean the bounded search did not find an acceptable move, not that a global optimum was proved.

The teacher is deterministic simulator search. This is supervised imitation of search results, not reinforcement learning and not new behavior discovered by the student during training. Historical hero runs provide context but are insufficient as the training corpus: the eleven `live-a-*` logs contain only nine accepted entries, which are not necessarily distinct or compatible with a single-move action.

## Training and comparison

Reuse the tested rank-8 LoRA recipe: one epoch, learning rate 0.0001, assistant-token loss, microbatch one, eight examples per update. For 1,200 examples this is 150 updates. No truncation is allowed. Run a small GPU smoke test before the full schedule. Use a fresh adapter with aliases `factory-optimizer-base` and `factory-optimizer-lora`.

Both model arms get the same initial factory, prompt format, parser, three proposal opportunities, 128 output-token limit and simulator budget. Subsequent prompts include that arm's previous actions and measured outcomes so deterministic decoding can revise a rejected proposal. There are at most 120 model requests across 20 factories, with no automatic retries. Record actual and offered budgets separately, including malformed actions, stop decisions and incomplete cases. Add a random legal-move baseline with the same three proposal opportunities.

Freeze the dataset, source, grader, model revision, adapter provenance and evaluation settings before running the held-out comparison. Use feedback days for move selection and separate final demand days only after both arms complete. The training VM receives training and validation files only. Final cases are supplied to the private inference endpoint by the local evaluator.

Primary outcomes are goal-pass rate, objective improvement, damage, and accepted changes on the final demand days. Report schema compliance separately. Report 20 independent building-level comparisons rather than treating 120 requests as independent experiments. Do not claim a general factory optimizer, real-world safety, or an improvement unless the measurements support it.

## Cost estimate and stop conditions

Crusoe's published on-demand A100 80GB PCIe rate checked on October 17, 2026 is $2 per GPU-hour. Persistent storage is $0.08 per GiB-month. The prior critic pilot used 17m47s of provisioned time; its measured 508,558-token training run took 216.455 seconds.

| Item | Estimate |
| --- | ---: |
| Local dataset generation and simulator scoring | No cloud charge |
| One A100 for setup, training, private serving and evaluation | 30-60 minutes, $1.00-$2.00 |
| 128 GiB boot storage for 30-60 minutes, assuming monthly proration | About $0.01-$0.02 |
| Expected incremental total | About $1.01-$2.02 |
| Proposed approval ceiling | $3 additional |
| Maximum creation-to-deletion window | 75 minutes |

At 75 minutes, published-rate compute is $2.50 and prorated storage is about $0.018. The $3 ceiling leaves approximately $0.48 of margin. This is a planning estimate, not a price guarantee or billing receipt. Confirm the instance quote before launch; stop rather than exceed the approved ceiling.

Arm guest shutdown at 65 minutes from bootstrap and track the independent 75-minute deadline from VM creation. Stop training/inference earlier if needed to retrieve artifacts. Recover the adapter, manifests, model responses and evaluation receipts, then delete the VM and its boot disk. Guest shutdown alone is not deletion or proof that storage billing stopped. Report the measured runtime estimate and final posted charge separately.

No continuous hosting, new paid teacher-model calls, changes to the frozen demo, or reuse of the previous pilot's spending approval are included.

## Verification and execution

The full TypeScript suite has 121 passing tests, including 19 new optimizer data/evaluation tests. Typecheck and seven Python VM tests pass. The evaluation fixtures verify that rejected or malformed moves change the next prompt, final-demand outcomes never enter model feedback, and an adapter from the earlier critic pilot is rejected.

An independent audit replayed 24,792 simulations and reproduced all 1,400 training/validation transitions and measurements. It also checked all 48 sampled alternatives for each of the 13 stop labels. No test factory was opened or scored. The pinned tokenizer measured 1,873,761 training tokens and 309,301 validation tokens. The longest example is 2,072 tokens, safely below the 4,096-token limit. These are preparation checks, not evidence that the optimizer model works.

The prepared deployment archive is `runs/vm-private/optimizer-v1-prepared.tar.gz`, SHA256 `bdacc95662c59424d699b3aeedab693cd36c12144ba2b27deef39c7f22a4adcd`. All copied file hashes match. It contains training and validation conversations; test factories and raw transition records are excluded. [Preparation receipt](optimizer-preparation.json).

The training-only archive is prepared with:

```sh
python3 training/vm/pack.py --data runs/optimizer-data/v1 --task-profile optimizer
```

After the approved VM trains and its output is retrieved, the final evaluation uses the recovered optimizer provenance:

```sh
npx tsx scripts/evaluate-optimizer.ts \
  --data runs/optimizer-data/v1 \
  --out runs/optimizer-eval/test-v1 \
  --provenance runs/optimizer-recovery/optimizer/provenance.json \
  --base-url http://127.0.0.1:8000/v1 \
  --factories 20 --max-calls 120 --max-tokens-per-arm 1000000 \
  --max-simulations-per-arm 480 --final-eval --live
```

The CLI freezes the exact checkpoint, data and code before checking endpoint health and reading test cases. Do not run this against the actual test set as a development preflight. Offline verification uses synthetic test fixtures.

Sources: [Crusoe pricing](https://www.crusoe.ai/cloud/pricing), [VM billing](https://docs.crusoecloud.com/compute/virtual-machines/overview/), [previous pilot receipt](nemotron-finetune-pilot.md).
