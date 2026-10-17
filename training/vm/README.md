# Bounded Nemotron critic training on an approved VM

This trains one LoRA epoch on the frozen training split and reports assistant-token validation loss before and after. It does not read the held-out file. The local server compares the adapter with the same pinned base weights by disabling the adapter for base requests. A lower validation loss is not evidence of better factory decisions; use the separate frozen evaluation harness.

Base: `nvidia/Llama-3.1-Nemotron-Nano-8B-v1` at `54641c1611fcff44fa4865626462445e0a153fc7`. One BF16-capable 80 GB CUDA GPU is required. This recipe has offline checks only until the approved GPU run completes.

Prompt profile `nemotron8b-thinking-off-v1` follows the model card: the system message is exactly `detailed thinking off`; canonical task instructions move into the user message before the task input. Training and both inference aliases use the same transformation. Canonical dataset files and hashes remain unchanged. The profile is recorded in the training manifest, provenance, and health endpoint.

Copy this directory and `manifest.json`, `train.jsonl`, `validation.jsonl` to the VM. Keep `test.jsonl` on the evaluation machine. Install only after VM spending is approved:

```sh
python -m pip install -r requirements.txt
python train.py --data /workspace/data --output /workspace/critic-smoke --smoke --max-steps 1 --max-seconds 300
python train.py --data /workspace/data --output /workspace/critic-run --max-steps 75 --max-seconds 2400
python serve.py --checkpoint /workspace/critic-run --port 8000
```

The default training plan is 600 examples, microbatch one, accumulation eight, 75 optimizer steps, rank 8, alpha 16, learning rate 0.0001, seed 20261017, and one epoch. Every full conversation is tokenized before training. Any example over 4096 tokens fails instead of being truncated. Only assistant tokens contribute to loss. The runtime ceiling is checked between model operations; it is not a cloud billing limit or a guarantee against a hung driver. The operator must stop/delete the VM on the approved deadline.

Use the provider's CUDA/PyTorch-ready VM image or official `pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime` container. No container is pulled or VM created by these files. The package versions are published on PyPI; their combination still needs the smoke run on this VM. No external tracking service is configured.

The server binds only `127.0.0.1`, has no public-bind option, and processes requests serially. To reach it from the evaluation machine:

```sh
ssh -L 8000:127.0.0.1:8000 ubuntu@APPROVED_VM
```

Base URL: `http://127.0.0.1:8000/v1`. Aliases: `factory-critic-base` and `factory-critic-lora`. Requests must use `temperature: 0`, text messages, no tools, no streaming, and `max_tokens` from 1 to 256. The server returns standard token usage. A placeholder API key is sufficient through the loopback tunnel. Do not expose this unauthenticated endpoint publicly.

`manifest.json` records the base revision, dataset hashes, hyperparameters, validation losses, GPU information and adapter file hashes. `provenance.json` supplies the evaluation harness's immutable-base identity. A failed or interrupted run is not serveable. Training output directories must be new; there is no automatic resume or retry.

Offline checks, with no model download or GPU:

```sh
python -m unittest discover -s training/vm -p 'test_*.py'
python training/vm/train.py --data runs/finetune-data/critic-v1 --output /tmp/unused --validate-only
```

Sources: [NVIDIA one-GPU LoRA configuration](https://docs.nvidia.com/nemo-helix/documentation/customizer-reference/models/llama-nemotron/), [pinned NVIDIA checkpoint](https://huggingface.co/nvidia/Llama-3.1-Nemotron-Nano-8B-v1/tree/54641c1611fcff44fa4865626462445e0a153fc7), [Transformers](https://pypi.org/project/transformers/4.51.3/), [PEFT](https://pypi.org/project/peft/0.15.2/), [PyTorch](https://pypi.org/project/torch/2.6.0/), [Accelerate](https://pypi.org/project/accelerate/1.6.0/), [Safetensors](https://pypi.org/project/safetensors/0.5.3/).

## Package and bootstrap

Prepare a private local archive without installing packages or launching compute:

```sh
python3 training/vm/pack.py --data runs/finetune-data/critic-v1
```

The archive under ignored `runs/vm-private/` contains only the Python/shell bundle and the verified training and validation files. It excludes held-out examples, raw labels, credentials, and historical run data. Its manifest includes hashes for every copied file. Transfer it only to the approved VM, extract it, and run `bash code/bootstrap.sh` from the extracted bundle.

Bootstrap first arms `factory-n1-hard-stop.timer` for guest shutdown after 105 minutes. Re-running setup preserves an already-active timer. It then runs the official PyTorch container with persistent cache/output mounts, installs the pinned requirements, runs the tiny smoke pass, runs the full frozen schedule, and starts the loopback server. Failure in either training pass prevents server startup. Existing training output is never overwritten.

Before shutdown, copy the entire `output/` directory back to the local project, including the adapter, manifests, provenance, and logs. Guest shutdown is a backup guard, not proof that billing stopped: verify the instance reaches **Stopped** in the Crusoe control plane. The OS disk can continue to incur charges until the VM is deleted. Do not cancel the shutdown timer merely to keep an idle endpoint alive.
