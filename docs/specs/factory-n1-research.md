# Research: Factory N+1

Discovery notes gathered 2026-10-17. These are notes, not decisions; the approved plan is in `factory-n1.md`.

## 1. Live Crusoe facts (verified on our account, 2026-10-17)

- Base URL: `https://api.inference.crusoecloud.com/v1` (OpenAI-compatible).
- Live NVIDIA IDs:
  - `nvidia/NVIDIA-Nemotron-3.5-Super-VL`
  - `nvidia/Nemotron-3.5-Lightning-30B-A3B` (262k context, tools)
  - `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
  - `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`
- Docs casing differs from the API, so resolve IDs against `/v1/models`.
- Tool calling verified on Lightning and Super VL with a real call into the simulator (`docs/evidence/2026-10-17-live-roundtrip.md`).
- Lightning fabricated a simulator re-run with invented after-numbers; the real sim refuted it. This is the core motivation for code-only grading.

## 2. Sponsor technology (web research)

### Crusoe Managed Inference
- **Base URL:** `https://api.inference.crusoecloud.com/v1` (OpenAI-compatible `/chat/completions`). **`GET /v1/models` is the source of truth.** Avoid older hosts (`api.crusoe.ai`, `managed-inference-api-proxy...`).
- **Model IDs** (from the hackathon skill file dated Oct 13; several are marked "confirm"):
  - `nvidia/Nemotron-3-Super-120B-A12B`: 262k context
  - `nvidia/nemotron-3.5-lightning-30b-a3b`: 1M context, "built for long-running agents and sub-agents"
  - `nvidia/Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`: 262k context
  - `nvidia/Nemotron-3-VoiceChat`
  - Non-NVIDIA: `deepseek-ai/DeepSeek-V4-Pro`, `deepseek-ai/Deepseek-V4-Flash`, `google/gemma-4-31b-it`, `openai/gpt-oss-120b`, `Qwen/Qwen3.8-27B`, `zai-org/GLM-5.3-Flash`
- **Rate limits:**
  - No card on file: **30 RPM / 500k TPM per model**. A parallel swarm will hit 429s.
  - With a card: **600 RPM / 2M TPM**. Add the card.
  - Responses carry `x-ratelimit-*` headers. Retry 429/503 with backoff and jitter.
- **Gotchas:**
  - Empty `content` means reasoning used up `max_tokens`; set it to 1024 or more.
  - On V4 Pro, enable thinking with `chat_template_kwargs: {"thinking": true}`.
  - Append the assistant `tool_calls` message before tool results, or you get a 400.
- **Shared-context angle:** **MemoryAlloy** prefix caching is a cluster-wide KV cache with cache-aware routing. Byte-identical shared prompt prefixes across agents are cheaper and faster.
  - The PromQL metrics API exposes `inference_counter_cached_prompt_token` per model, plus TTFT and latency histograms.
  - Get a metrics token with `crusoe monitoring tokens create`.
  - **Measurable Shared Brain metric:** put the Playbook in a stable prompt prefix and show the cached-token ratio rising.
- **Hackathon repo:** only `README.md` and `crusoe-cv-recursive-agents-hackathon-skill.md`. Drop the skill file into the coding agent. The free credits require a card. Set the key to expire Oct 18; it's shown once.

### Nemotron 3.5 Super
- **Exact name:** **Nemotron 3.5 Super VL**, a 120B total / 12B active hybrid Mamba-Transformer MoE. Multimodal (text, image, doc, video), with reasoning and tool use.
- **Release:** NVIDIA blog dated Oct 15. The kickoff said "yesterday".
- **Context and benchmarks:**
  - Context is 1M per OpenRouter.
  - Artificial Analysis index 26, which it calls the top US open-weight model; Nemotron 3 Super scored 13.
  - About 60% fewer output tokens per task.
- **Companion release:** Nemotron 3.5 Bolt 74B-A9B.
- **Where it's served:**
  - HF: `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4`
  - build.nvidia.com: `nemotron-3.5-super-vl-120b-a12b`
  - OpenRouter: `nvidia/nemotron-3.5-super-vl` (free variant available)
- **On Crusoe: unverified.** NVIDIA lists Crusoe as a provider, but it isn't in the skill file. **Fallbacks:** `Nemotron-3-Super-120B-A12B` or `nemotron-3.5-lightning-30b-a3b`.
- The VL capability allows a nice trick: send it a **screenshot of the 3D floor** and have it critique the layout visually.

### NemoClaw + OpenShell (side prize)
- **What it is:** NemoClaw (alpha) runs OpenClaw, Hermes or LangChain Deep Agents inside **OpenShell** sandboxes, with egress policy and operator approval, routed inference, and hardening.
- **Install:** `curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash`. This is a remote script; review it before running.
- **Platform:** Linux/DGX first and **macOS partial**. Use Forge or a Crusoe VM, not the MBP.
- **Custom endpoint:** pointing it at the Crusoe endpoint is unverified.
- **"Best use" (inference, not official criteria):** run the swarm in OpenShell with egress limited to the Crusoe API, and show a blocked-egress or approval event live.

### NeMo Switchyard (the "switchboard")
- **What it is:** NVIDIA's open-source per-call model router (Rust, pre-alpha). The Granola transcript's "Nemo Switcher" is this.
- **Install:** `uv tool install "nemo-switchyard[cli,server]"`. Repo: github.com/NVIDIA-NeMo/Switchyard.
- **Default backend:** OpenRouter. A Crusoe backend config is unverified.
- **Fit:** escalate from Lightning to Super on hard steps. If wiring it in takes too long, do the same escalation in our own code and name the pattern.

### Cosmos
- **Catalog:** `cosmos3-nano` (physics-aware video generation), `cosmos3-nano-reasoner` (video/image reasoning VLM), and a free `cosmos-transfer2.5-2b` endpoint. Reason1 API deprecated 2026-03-24.
- **Fit:** too slow for a live loop. At most, a reasoner check on a sim frame. Live endpoint status is unverified. Future-potential slide only.

## 3. Prior art: MongoDB SF hackathon winners (Oct 11, 2026)

### MongoMation: agent that writes, tests and repairs PLC programs

**How the 3D factory was built: they didn't build it.** The 3D plant is **Factory I/O**, a commercial 3D industrial training simulator (Windows) that they ran on AWS. It's driven by **OpenPLC**, which runs the generated Structured Text. The "control room" UI was built on **Modelence**.

Loop:
1. Machine spec → requirements → Structured Text (Claude). The harness owns the I/O mapping.
2. OpenPLC compiles; Factory I/O supplies measured plant signals; an **independent grader** decides pass/fail.
3. A critic repairs failed programs. A separate **meta-agent proposes harness changes**, gated by a **frozen benchmark + safety gate**.

Stack: MongoDB Atlas (job queue, leases, stage checkpoints, measurements, versioned config, retrieval), Voyage/Atlas Search (recall prior failures and proven programs), Raindrop (traces).

**Why it reads well:** a real physical-ish plant, an independent verifier separate from the generator, a repair loop, and a meta-level gated by a frozen benchmark. Its README reports program repair but zero accepted harness-improvement revisions.

### LabRat: physical lab assistant that simulates, asks permission and learns

Loop:
1. A colour goal is entered in the FastAPI console. Claude recalls memory, designs 2 variants, and calls a native simulator.
2. A **Three.js 3D twin** replays the proposed protocol. An `awaiting_approval` state gates real hardware.
3. Learning path: **refit simulator parameters from observations → re-score → promote memory**.

Stack: FastAPI + Python agent, MongoDB/Voyage memory, Three.js console, USB bridge to hardware.

Per its `docs/architecture.md`, the refit is a ridge least-squares fit of the simulator's parameters, installed only if mean prediction error drops. Codex's review of the post-event code found it calibrates a small numerical model on the same readings, so it isn't evidence of LLM fine-tuning or held-out generalization.

**Takeaway for us:** the visible 3D twin and the approval gate carry a lot of demo weight. A measured improvement across iterations is the part we can make central.

Public repos: MongoMation https://github.com/zubair480/MongoMation · LabRat https://github.com/JacobFV/labrat

## 4. 3D world and assets (source review of both winners, MIT-licensed repos)

**Both used plain three.js. Neither shows "agent thinking" inside the 3D scene; they show it in 2D panels next to it.**

### MongoMation (`apps/web/src/client/plc3d/*`, about 2,050 dense lines)
- **Geometry:** no GLTF. Box, Cylinder, RoundedBox, Tube and Plane primitives with a `MeshStandardMaterial` palette. `CanvasTexture` for nameplates, HMI screens, floor tiles, belts and hazard tape.
- **Lighting:** RoomEnvironment PMREM, hemisphere light, one 2048px PCFSoft shadowed sun, ACES tone mapping, and matching fog. No post-processing.
- **Performance:** `mergeStatic()` collapses static meshes per material; InstancedMesh for racks and cartons; a `quality:'low'` mode.
- **Animation:**
  - Belts are scrolling texture offsets.
  - The live plant is fed at about 20 Hz over WebSocket. It renders 110 ms behind, interpolates between bracketing frames, and holds the last frame rather than extrapolating.
  - Camera flights are eased legs with lift, hold, a caption and an idle orbit, plus `setViewOffset` to clear the side panel.
- **Demo strength:** cinematic entry, dense set dressing, honest status lamps (only real state lights them).
- **Caveat:** the room was adapted from the author's earlier repo.

### LabRat (event-day commit `e74dabc`, `web/twin.js` 428 lines)
- **Assets:** hybrid. A GLB generated from their own CAD script plus a URDF arm, with box stand-ins shown until the GLBs load (and kept if they fail).
- **Animation:** replays a deterministic sim trace: `{t, step, label, …}` frames, a speed multiplier (1/4/16/64×), and a scrubber. It snaps to frames with no interpolation. Live mode reuses the same setters.
- **Agent link:** the agent designs N variants. Each simulated variant is pushed over WebSocket and auto-played on the twin while gallery cards fill with scores. The best one gets an "Approve run" card. A Learning tab shows the refit error dropping, accepted only if it improves.

### Assets
| Source | License | Use |
|---|---|---|
| Kenney Factory Kit 3.0 | CC0, GLB | Conveyors (straight/corner/T/slope), boxes, robot arms, scanners, pushers, machines, floor indicators. Has node animation clips. |
| Kenney Car Kit | CC0, GLB | Delivery van and flatbed truck at the docks |
| Poly Pizza (Quaternius pallet/crate) | CC0 | Pallets and crates. The KolosStudios forklift is CC-BY 3.0 and needs credit. |

**Gotchas:**
- Kenney GLBs reference an external `Textures/colormap.png`; serve it over HTTP.
- Assets are about 1 unit per tile, so snap to the integer grid.
- Pin the three.js version.
- There's no confirmed CC0 forklift or AGV; build one from code.

### Patterns to copy
1. Keep the scene as an imperative module: `createWarehouse(host) → {loadLayout, applyFrame, setShot, dispose}`.
2. Give every frame an explicit `t`, advance with a rAF clock × speed, interpolate between bracketing frames, and never extrapolate.
3. Add a scrubber, a speed select and a "gen N · replay" badge.
4. Stream each candidate as it's simulated and auto-play it; show a gallery of candidates with score swatches.
5. Cinematics: staggered reveal, eased camera legs with captions, idle orbit, `setViewOffset`.
6. Belts are texture scrolls, packages are one InstancedMesh, emissive stack lights mark jams.
7. Merge static meshes per material. One shadowed sun + RoomEnvironment + ACES; skip post-processing.

### Traps
- Snapping makes packages teleport, so interpolate.
- Don't build 3D "thinking" visuals; use 2D panels.
- Don't use one mesh per box.
- Don't embed external viewers.
- Don't mix asset kits: use the Kenney Factory Kit plus code-built shapes.

## 5. Baseline probes (run 2026-10-17 ~11:15 PT on SIM 1.0.0, BEFORE the identity fix)

> These numbers came from the buggy engine. Corrected numbers on SIM 1.1.0 are in `factory-n1.md` (Measured baselines); the conclusions held.

**Is the design problem too easy?** Random-mutation hill-climber, no LLM, scored on train only:

| Sim evals | Train | Select | Test | Test DoD |
|---|---|---|---|---|
| 30 | 12,455 | 12,852 | 15,965 | ✗ |
| 100 | 4,429 | 4,620 | 5,566 | ✗ |
| 3,000 (seed 1) | 2,579 | 2,610 | 2,844 | ✗ (overfit: fails the skewed test days) |
| 3,000 (seed 2) | 2,562 | 2,621 | 2,612 | ✓ |

For comparison: the hand-built reference scores 3,509 train / 3,427 test ✓, and the Gen-0 baseline 17,915.

**Single-shot Lightning** (5 samples, given the world description and baseline results):
- Thinking on (8k tokens): 4/5 empty replies (reasoning used up the budget), 1/5 malformed JSON.
- Thinking off: 3/5 broke hard constraints. 2/5 were valid at ≈13,200 train, failing the DoD. One rationale asserted a constraint violation that doesn't exist. Cost $0.0008.

**Implications:**
- One LLM call doesn't solve it; validation, repair and iteration are necessary.
- Compare against blind search at an **equal eval budget** (the team uses about 30 evals).
- The select split must be larger (10–12 seeds) and the gate needs a margin, or the ratchet will overfit like the climber.
