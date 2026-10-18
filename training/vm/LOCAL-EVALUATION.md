# VM-local comparison draft

This adds packaging and process supervision only. It reuses the recovered base checkpoint and three LoRA adapters and the unchanged evaluator. It does not train, change the grader, publish results, or modify the frozen demo.

The server and evaluator run in separate systemd-managed containers on the same VM. They use `127.0.0.1:8000`; no SSH tunnel or externally published model port is needed. Disconnecting the SSH client that launched the supervisor does not terminate either service. A model/server failure still ends the comparison conservatively. Unknown request receipts are preserved and are never retried automatically.

The proposed budget is 85 minutes from VM creation through deletion. Setup must finish by minute 20, inference evaluation is capped at 50 minutes, and VM work stops by minute 75. The remaining ten minutes are for external recovery/deletion confirmation. The launcher does not create or delete a VM. Poweroff does not prove cloud deletion or zero continuing storage charges.

## Local preparation after review

Apply this patch only after review. Generate and seal the new 20-factory dataset separately. Exclude all previous test and probe geometries. Record the dataset and source hashes before any model queries. Keep the unchanged v2 train/validation files beside the new test file solely for provenance and later audit.

The VM needs Linux, systemd, Docker, an NVIDIA container runtime, Python 3.10 or newer, and one A100 80GB PCIe GPU.

Resolve an official Linux amd64 Node 22.23.3 image to a digest and record that digest. The packer requires `repository@sha256:...`, not a mutable tag. The PyTorch base digest comes from the previous VM receipt. Both derived image IDs, the npm lockfile, Python package versions, Node/npm versions and GPU driver receipt are retained. No Docker image build or pull is performed by local packaging.

```sh
python3 -m unittest discover -s training/vm -p test_local_eval.py
python3 training/vm/pack_local_eval.py \
  --repo . --data runs/optimizer-data/v3-eval \
  --v1 runs/optimizer-recovery/optimizer \
  --old3 runs/optimizer-v2-recovery/old3 \
  --v2 runs/optimizer-v2-recovery/v2 \
  --node-image 'node@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562' \
  --job-id fresh-comparison \
  --out runs/optimizer-v3-private/fresh-comparison
```

The packer checks the recovered adapter files against their training manifests, pins the common base revision, and checks all dataset file hashes without parsing or scoring test cases. The bundle contains code, lockfile, datasets, recovered adapters and expected health. It excludes credentials and previous evaluation outputs. Base-model weights are not in the recovered adapter bundle. The supervisor downloads the pinned public base revision during the setup window and then starts the server in offline mode.

## Launch after explicit spending approval

Create the approved VM and record its creation epoch and absolute minute-75 workstop epoch before transfer. Transfer the archive plus its SHA-256 receipt. Verify the archive checksum on the VM before extraction. Extract to a new directory and run its verifier. Keep the launch path stable.

```sh
python3 /opt/factory/fresh-comparison/vm/local_eval.py verify \
  --root /opt/factory/fresh-comparison
sudo python3 /opt/factory/fresh-comparison/vm/local_eval.py launch \
  --root /opt/factory/fresh-comparison \
  --created-at APPROVED_VM_CREATION_EPOCH \
  --deadline APPROVED_CREATION_PLUS_4500_EPOCH \
  --approve-vm-run
```

Launch arms two systemd timers before starting preparation: a finalize timer three minutes before workstop and an independent absolute poweroff timer. The supervisor builds pinned containers, runs a CPU-only Node import and mount smoke check without reading test cases, downloads the base weights, starts the model server as its own service, verifies exact expected health, then starts the evaluator as its own service. All services have a finite runtime and `Restart=no`. Repeated launch is rejected. Do not reset the creation timestamp or deadline on reconnect.

Source and input mounts are read-only. The Node container uses the canonical repository path `/Users/bshyong/Code/factory-n1-final`, with the fresh data at `runs/optimizer-data/v3-eval` and output at `runs/optimizer-eval/v3-vm`. The evaluator freezes its plan inside that container. Recovered evidence therefore resolves to the same canonical paths on the laptop without rewriting the frozen plan. Node dependencies live in the parent directory in the image.

The host output directory is `output/`. It retains request receipts, simulator receipts, checkpoint, source/data/model hashes, logs and container image IDs. Request files are written before inference. A normal SSH interruption needs no resume action. A process interruption requires explicit inspection; the existing evaluator's `--resume` rejects unresolved requests. No automatic new run, retry, timer extension or exclusion is introduced here.

## Recovery and proof before deletion

Read `output/status.json` or `systemctl status factory-eval-fresh-comparison-supervisor`. On success or failure the supervisor stops the two containers and writes a checksummed archive under `artifacts/`. The underlying VM remains scheduled to power off at its original workstop. A setup failure parks automatically after sealing available evidence: the VM powers off, and the operator must delete it promptly without extending the setup budget.

Copy the newest `artifacts/receipts-*.tar.gz` and matching `.sha256.json` before workstop, using sudo-aware SSH retrieval if needed because receipts are mode 0600. Verify the archive hash locally, extract to a new recovery directory, and verify every `output/artifact-manifest.json` entry. Preserve the original archive. Then copy the evidence directory without rewriting it to local `runs/optimizer-eval/v3-vm` and run the independent auditor using the same fresh data and source bundle. The canonical local directory must be unused before launch/recovery.

For a hung service, the finalize timer stops both services and seals whatever receipts exist, and the independent poweroff timer still fires even if archival fails. The operator must retrieve evidence and delete the cloud VM, then save the provider deletion receipt and actual spend. Never treat a systemd shutdown receipt as a provider deletion receipt. If automatic poweroff arrives before retrieval, the disk still contains receipts; any paid restart for recovery needs remaining authorization and must retain the original total cap.

During the approved setup window, run a CPU-only smoke container with a fake local server, close its SSH session while it is processing, reconnect and verify that both unit PIDs and the output receipt sequence continued. Offline unit tests here validate command construction, checksums, deadlines and receipt preservation; they do not prove Docker/NVIDIA/systemd behavior on a live VM.
