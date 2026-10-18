"""Run the unchanged evaluator and server under systemd, independently of SSH."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def verify(root):
    root = Path(root).resolve()
    manifest = json.loads((root / "bundle-manifest.json").read_text())
    for name, digest in manifest["files"].items():
        path = root / name
        if path.is_symlink() or not path.resolve().is_relative_to(root) or sha(path) != digest:
            raise ValueError("Bundle mismatch: " + name)
    config = json.loads((root / "job-config.json").read_text())
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", config["jobId"]):
        raise ValueError("Invalid job ID")
    if config["budgetUsd"] != 3 or config["maxVmMinutes"] != 85 or config["workstopMinutes"] != 75 or config["setupMinutes"] != 20 or not 1 <= config["evaluationMinutes"] <= 50 or config["training"]:
        raise ValueError("Unexpected job scope")
    return config


def remaining_budget(created_at, deadline, now):
    if not all(isinstance(v, int) for v in (created_at, deadline, now)) or created_at > now:
        raise ValueError("Invalid creation timestamp")
    if deadline > created_at + 75 * 60 or deadline <= now + 240:
        raise ValueError("Deadline must fit original 75-minute workstop with retrieval margin")
    return deadline - now


def command(args, timeout=None, check=True, capture=False):
    return subprocess.run([str(arg) for arg in args], check=check, timeout=timeout,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.STDOUT if capture else None, text=True)


def prefix(config):
    return "factory-eval-" + config["jobId"]


def container_command(root, config, kind):
    root = Path(root).resolve()
    name = prefix(config) + "-" + kind
    base = ["/usr/bin/docker", "run", "--rm", "--name", name, "--network", "host", "--read-only",
            "--tmpfs", "/tmp:rw,nosuid,size=1g"]
    if kind == "server":
        return base + ["--gpus", "device=0", "--shm-size", "8g", "-e", "HF_HOME=/workspace/cache/huggingface",
            "-e", "HF_HUB_OFFLINE=1", "-v", str(root / "vm") + ":/workspace/code:ro",
            "-v", str(root / "models") + ":/workspace/models:ro", "-v", str(root / "cache") + ":/workspace/cache:ro",
            "-v", str(root / "output") + ":/workspace/output", prefix(config) + ":server",
            "python", "/workspace/code/serve_comparison.py", "--v1", "/workspace/models/v1",
            "--old3", "/workspace/models/old3", "--v2", "/workspace/models/v2", "--provenance", "/workspace/output/server-provenance.json"]
    if kind == "evaluator":
        return base + ["--workdir", "/Users/bshyong/Code/factory-n1-final", "-e", "FACTORY_EVAL_MINUTES=" + str(config["evaluationMinutes"]),
            "-v", str(root) + ":/Users/bshyong/Code/factory-n1-final:ro",
            "-v", str(root / "data") + ":/Users/bshyong/Code/factory-n1-final/runs/optimizer-data/v3-eval:ro",
            "-v", str(root / "output/evaluation") + ":/Users/bshyong/Code/factory-n1-final/runs/optimizer-eval",
            prefix(config) + ":node", "bash", "/Users/bshyong/Code/factory-n1-final/vm/local-eval-entry.sh"]
    raise ValueError("Unexpected container kind")


def start_unit(root, config, kind, args, seconds):
    name = prefix(config) + "-" + kind
    props = ["--property=Restart=no", "--property=KillMode=control-group", "--property=TimeoutStopSec=20",
             "--property=RuntimeMaxSec=" + str(seconds), "--property=StandardOutput=append:" + str(root / "output" / (kind + ".log")),
             "--property=StandardError=inherit"]
    if kind in ("server", "evaluator"):
        props += ["--property=ExecStopPost=-/usr/bin/docker rm -f " + name]
    command(["systemd-run", "--unit", name] + props + list(args))


def status(root, state, **extra):
    save(root / "output/status.json", {"state": state, "at": int(time.time()), **extra})


def units_stop(root, config, include_supervisor=False):
    names = [prefix(config) + "-" + kind for kind in ("evaluator", "server")]
    if include_supervisor:
        names.insert(0, prefix(config) + "-supervisor")
    errors = []
    for name in names:
        for args in (["systemctl", "stop", name], ["docker", "rm", "-f", name]):
            try:
                result = command(args, timeout=5, check=False)
                if result.returncode:
                    errors.append({"command": args, "returncode": result.returncode})
            except (subprocess.TimeoutExpired, OSError) as error:
                errors.append({"command": args, "error": type(error).__name__})
    return errors


def seal(root, config):
    output = root / "output"
    for kind in ("supervisor", "server", "evaluator"):
        name = prefix(config) + "-" + kind
        try:
            details = command(["systemctl", "show", name, "--no-pager"], timeout=3, check=False, capture=True)
            text = details.stdout or ""
        except (subprocess.TimeoutExpired, OSError) as error:
            text = "Unit inspection failed: " + type(error).__name__
        (output / (kind + "-unit.txt")).write_text(text)
    files = {str(path.relative_to(output)): sha(path) for path in output.rglob("*") if path.is_file() and path.name != "artifact-manifest.json"}
    save(output / "artifact-manifest.json", {"createdAt": int(time.time()), "bundleManifestSha256": sha(root / "bundle-manifest.json"), "files": files})
    artifacts = root / "artifacts"
    artifacts.mkdir(exist_ok=True)
    archive = artifacts / ("receipts-" + str(time.time_ns()) + ".tar.gz")
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(output, arcname="output")
    archive.chmod(0o600)
    save(archive.with_suffix(".sha256.json"), {"archive": archive.name, "sha256": sha(archive), "bytes": archive.stat().st_size})


def supervise(root):
    config = verify(root)
    launch = json.loads((root / "output/launch.json").read_text())
    deadline = launch["deadline"]
    setup_deadline = min(launch["createdAt"] + config["setupMinutes"] * 60, deadline - config["evaluationMinutes"] * 60 - 180)
    evaluation_started = False
    try:
        status(root, "preparing", deadline=deadline)
        for kind in ("server", "node"):
            command(["docker", "build", "--pull=false", "-f", root / (kind + ".Dockerfile"), "-t", prefix(config) + ":" + kind, root], timeout=max(1, setup_deadline - int(time.time())))
        smoke = container_command(root, config, "evaluator")
        smoke[smoke.index("--name") + 1] = prefix(config) + "-cpu-smoke"
        smoke_code = "import fs from 'node:fs'; import {graderHash} from './src/sim/version.ts'; await import('./src/training/optimizer-v2-evaluate.ts'); const p='runs/optimizer-eval/.mount-smoke'; fs.writeFileSync(p,'ok'); fs.unlinkSync(p); if(!fs.existsSync('runs/optimizer-data/v3-eval/manifest.json'))throw Error('data mount missing'); console.log(JSON.stringify({cwd:process.cwd(),graderHash:graderHash(),readTestCases:false,modelCalls:0}));"
        smoke = smoke[:-2] + ["node", "--import", "tsx", "--input-type=module", "-e", smoke_code]
        smoke_result = json.loads(command(smoke, timeout=30, capture=True).stdout)
        expected = json.loads((root / "expected-health.json").read_text())
        if smoke_result["graderHash"] != expected["models"]["factory-optimizer-v2"]["dataset"]["graderHash"]:
            raise ValueError("CPU smoke grader hash mismatch")
        save(root / "output/cpu-smoke.json", smoke_result)
        # Only the immutable public base checkpoint is downloaded; no training is invoked.
        warm = ["docker", "run", "--rm", "--name", prefix(config) + "-warm", "-e", "HF_HOME=/cache/huggingface",
                "-v", str(root / "cache") + ":/cache", prefix(config) + ":server", "python", "-c",
                "from huggingface_hub import snapshot_download; snapshot_download(repo_id=" + repr(config["baseModel"]) + ",revision=" + repr(config["baseRevision"]) + ",allow_patterns=['*.safetensors','*.json','tokenizer.model','*.txt','*.jinja','*.tiktoken'])"]
        command(warm, timeout=max(1, setup_deadline - int(time.time())))
        versions = {}
        for name, args in {
            "pythonPackages": ["docker", "run", "--rm", prefix(config) + ":server", "python", "-m", "pip", "freeze"],
            "node": ["docker", "run", "--rm", prefix(config) + ":node", "node", "--version"],
            "npm": ["docker", "run", "--rm", prefix(config) + ":node", "npm", "--version"],
            "gpu": ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
        }.items():
            versions[name] = command(args, timeout=20, capture=True).stdout.strip()
        gpus = versions["gpu"].splitlines()
        if len(gpus) != 1 or "A100" not in gpus[0] or "pcie" not in gpus[0].lower() or int(gpus[0].split(",")[1].strip()) < 75000:
            raise ValueError("Expected one A100 80GB PCIe GPU")
        save(root / "output/runtime-versions.json", versions)
        image_receipt = command(["docker", "image", "inspect", prefix(config) + ":server", prefix(config) + ":node"], timeout=15, capture=True)
        save(root / "output/container-images.json", json.loads(image_receipt.stdout))
        start_unit(root, config, "server", container_command(root, config, "server"), max(1, deadline - int(time.time()) - 180))
        expected = json.loads((root / "expected-health.json").read_text())
        ready_by = min(int(time.time()) + 300, setup_deadline)
        while int(time.time()) < ready_by:
            try:
                with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5) as response:
                    health = json.load(response)
                if health != expected:
                    raise ValueError("Serving health differs from packaged checkpoints")
                break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(2)
        else:
            raise RuntimeError("Server not ready with enough time for full evaluation")
        verify(root)
        evaluation_started = True
        status(root, "evaluating", deadline=deadline)
        start_unit(root, config, "evaluator", container_command(root, config, "evaluator"), config["evaluationMinutes"] * 60 + 120)
        while int(time.time()) < deadline - 180:
            state = command(["systemctl", "show", prefix(config) + "-evaluator", "--property=ActiveState", "--value"], timeout=5, capture=True).stdout.strip()
            if state in ("inactive", "failed"):
                break
            time.sleep(2)
        metrics = root / "output/evaluation/v3-vm/metrics.json"
        result = json.loads(metrics.read_text()) if metrics.exists() else {}
        complete = result.get("completed") is True and result.get("terminalReason") is None
        status(root, "completed" if complete else "incomplete", deadline=deadline, terminalReason=result.get("terminalReason"))
    except Exception as error:
        status(root, "failed", deadline=deadline, errorType=type(error).__name__, message=str(error)[:500])
        raise
    finally:
        try:
            errors = units_stop(root, config)
            try:
                command(["docker", "rm", "-f", prefix(config) + "-warm"], timeout=5, check=False)
            except (subprocess.TimeoutExpired, OSError) as error:
                errors.append({"warmCleanup": type(error).__name__})
            save(root / "output/cleanup.json", {"errors": errors})
            seal(root, config)
        finally:
            if not evaluation_started:
                command(["/sbin/shutdown", "-h", "now"], check=False)


def launch(root, created_at, deadline, approved):
    if not approved:
        raise ValueError("Explicit --approve-vm-run is required")
    if os.geteuid() != 0:
        raise ValueError("Run launch with sudo so systemd survives logout")
    config = verify(root)
    remaining = remaining_budget(created_at, deadline, int(time.time()))
    if (root / "output/launch.json").exists():
        raise ValueError("Job already launched; inspect its durable state instead of restarting it")
    for name in ("output/evaluation", "cache", "artifacts"):
        (root / name).mkdir(parents=True, exist_ok=True)
    save(root / "output/launch.json", {"createdAt": created_at, "deadline": deadline, "launchedAt": int(time.time()), "approved": approved, "bundleManifestSha256": sha(root / "bundle-manifest.json")})
    script = root / "vm/local_eval.py"
    # Poweroff remains independent of the supervisor and artifact export.
    calendar = lambda epoch: datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    command(["systemd-run", "--unit", prefix(config) + "-poweroff", "--on-calendar=" + calendar(deadline), "--timer-property=AccuracySec=1s", "/sbin/shutdown", "-h", "now"])
    command(["systemd-run", "--unit", prefix(config) + "-finalize", "--on-calendar=" + calendar(deadline - 180), "--timer-property=AccuracySec=1s", "/usr/bin/python3", script, "finalize", "--root", root])
    start_unit(root, config, "supervisor", ["/usr/bin/python3", script, "supervise", "--root", root], remaining - 180)
    print(json.dumps({"supervisor": prefix(config) + "-supervisor", "deadline": deadline, "note": "SSH may disconnect safely. VM poweroff is not cloud resource deletion."}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("verify", "launch", "supervise", "finalize"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--created-at", type=int)
    parser.add_argument("--deadline", type=int)
    parser.add_argument("--approve-vm-run", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if args.mode == "verify":
        print(json.dumps(verify(root), indent=2))
    elif args.mode == "launch":
        launch(root, args.created_at, args.deadline, args.approve_vm_run)
    elif args.mode == "supervise":
        supervise(root)
    else:
        config = verify(root)
        errors = units_stop(root, config, include_supervisor=True)
        metrics = root / "output/evaluation/v3-vm/metrics.json"
        try:
            result = json.loads(metrics.read_text()) if metrics.exists() else {}
        except (OSError, ValueError):
            result = {}
        if result.get("completed") is not True or result.get("terminalReason") is not None:
            status(root, "incomplete", terminalReason="workstop_finalizer", cleanupErrors=errors)
        save(root / "output/finalizer.json", {"at": int(time.time()), "cleanupErrors": errors})
        seal(root, config)

if __name__ == "__main__":
    main()
