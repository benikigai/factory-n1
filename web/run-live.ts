/**
 * "Run live" control. Loaded only behind `import.meta.env.DEV`, so production and static builds never contain
 * it. It appears only if the local dev server answers /api/run/status (see live-runner.ts).
 */
type Status = {
  available: boolean;
  configured: boolean;
  running: boolean;
  runId: string | null;
  caps: { calls: number; usd: number };
  presets: Record<string, string>;
  last: { runId: string; exitCode: number | null; message: string } | null;
  resumable: { runId: string; fromGeneration: number } | null;
};

const API = "/api/run";
const INSPECT = "/api/inspect";

/** Hooks the replay viewer passes in, so Inspect can read the current run and replay time. */
export type ViewerHooks = { runId(): string | null; time(): number; hasReplay(): boolean; onInspected(runId: string): void };
type InspectStatus = {
  running: boolean;
  runId: string | null;
  caps: { calls: number; usd: number };
  last: { runId: string; ok: boolean; message: string; verified?: boolean; findings?: number; calls?: number; usd?: number } | null;
};

async function inspectStatus(): Promise<InspectStatus | null> {
  try {
    const r = await fetch(`${INSPECT}/status`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as InspectStatus) : null;
  } catch {
    return null;
  }
}

/** An unpredictable marker that appears only in the image's pixels, never in any prompt text. */
function marker(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => chars[n % chars.length]).join("");
}

/** Copy the 3D frame right after the viewer draws it, then stamp the IMAGE CHECK plaque onto the copy. */
async function captureFrame(code: string): Promise<string> {
  const gl = document.querySelector<HTMLCanvasElement>("#scene canvas");
  if (!gl) throw new Error("No 3D view to capture.");
  // Two frames: the second callback runs after the viewer's render in the same frame, while the buffer is intact.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const scale = Math.min(1, 1600 / gl.width);
  const out = document.createElement("canvas");
  out.width = Math.round(gl.width * scale);
  out.height = Math.round(gl.height * scale);
  const g = out.getContext("2d")!;
  g.fillStyle = "#151a21";
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(gl, 0, 0, out.width, out.height);
  const text = `IMAGE CHECK: ${code}`;
  g.font = "800 26px ui-monospace, Menlo, monospace";
  const w = g.measureText(text).width + 32;
  g.fillStyle = "#f8fafc";
  g.fillRect(16, out.height - 76, w, 54);
  g.strokeStyle = "#7c3aed";
  g.lineWidth = 3;
  g.strokeRect(16, out.height - 76, w, 54);
  g.fillStyle = "#0f172a";
  g.fillText(text, 32, out.height - 40);
  return out.toDataURL("image/png");
}

async function status(): Promise<Status | null> {
  try {
    const r = await fetch(`${API}/status`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as Status) : null;
  } catch {
    return null;
  }
}

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = (await r.json().catch(() => ({}))) as { runId?: string; error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function mountRunLive(host: HTMLElement, viewer?: ViewerHooks) {
  const first = await status();
  if (!first?.available) return; // static hosting or preview: no control at all
  const box = document.createElement("div");
  box.className = "run-live";
  host.append(box);
  const render = (s: Status, note = "") => {
    const presets = Object.entries(s.presets)
      .map(([id, label]) => `<button type="button" data-preset="${id}" ${s.running || !s.configured ? "disabled" : ""}>${label}</button>`)
      .join("");
    const resume = !s.running && s.configured && s.resumable
      ? ` <button type="button" data-resume="${s.resumable.runId}">Resume ${s.resumable.runId} from gen ${s.resumable.fromGeneration}</button>`
      : "";
    const state = s.running
      ? `<span class="rl-dot"></span><a href="./replay.html?run=${s.runId}">${s.runId}</a> running <button type="button" data-stop>Stop</button>`
      : !s.configured
        ? "Set FACTORY_ENV_FILE and restart the dev server to enable live runs."
        : s.last
          ? `Last: <a href="./replay.html?run=${s.last.runId}">${s.last.runId}</a> ${s.last.exitCode === 0 ? "finished" : `stopped: ${s.last.message.replace(/</g, "&lt;")}`}`
          : `Caps per run: ${s.caps.calls} calls, $${s.caps.usd.toFixed(2)}.`;
    box.innerHTML = `<span class="rl-title">Run live on Crusoe</span><span class="rl-presets">${presets}</span><span class="rl-state">${note || state}${resume}</span>${viewer ? `<span class="rl-inspect">${inspectHtml()}</span>` : ""}`;
  };
  // Inspect with Super VL: post-run only, one attempt per click, spend shown from the inspector's own record.
  let insp: InspectStatus | null = viewer ? await inspectStatus() : null;
  let inspectNote = "";
  let lastSeen = JSON.stringify(insp?.last ?? null);
  const inspectHtml = () => {
    if (!viewer || !insp) return "";
    const id = viewer.runId();
    const busy = insp.running;
    const btn = `<button type="button" data-inspect ${busy || !viewer.hasReplay() || !id ? "disabled" : ""}>Inspect ${id ?? "run"} with Super VL</button>`;
    const l = insp.last;
    const result = busy
      ? `<span class="rl-dot"></span>Inspecting ${insp.runId}… caps ${insp.caps.calls} calls, $${insp.caps.usd.toFixed(2)}`
      : l
        ? `Last inspection of ${l.runId}: ${l.ok ? `${l.verified ? "image verified" : "image NOT verified"} · ${l.findings ?? 0} findings` : `stopped: ${l.message.replace(/</g, "&lt;")}`}${l.usd !== undefined ? ` · $${Number(l.usd).toFixed(4)} · ${l.calls ?? 0} calls` : ""}`
        : `Post-run check; does not change the layout or grader. Caps ${insp.caps.calls} calls, $${insp.caps.usd.toFixed(2)}.`;
    return `${btn} <span>${inspectNote || result}</span>`;
  };
  render(first);
  box.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    try {
      if (t.dataset.preset) {
        const { runId } = await post(API, { preset: t.dataset.preset });
        location.href = `./replay.html?run=${encodeURIComponent(runId!)}`;
      } else if (t.dataset.resume) {
        const { runId } = await post(`${API}/resume`, { runId: t.dataset.resume });
        location.href = `./replay.html?run=${encodeURIComponent(runId!)}`;
      } else if (t.dataset.inspect !== undefined && viewer) {
        const runId = viewer.runId();
        if (!runId) return;
        inspectNote = "Capturing frame…";
        render((await status()) ?? first);
        const code = marker();
        const image = await captureFrame(code);
        await post(INSPECT, { runId, marker: code, time: viewer.time(), image });
        inspectNote = "";
        insp = await inspectStatus();
        render((await status()) ?? first);
      } else if (t.dataset.stop !== undefined) {
        await post(`${API}/stop`);
      }
    } catch (err) {
      inspectNote = "";
      const s = await status();
      if (s) render(s, (err as Error).message);
    }
  });
  setInterval(async () => {
    const s = await status();
    if (viewer) {
      insp = await inspectStatus();
      const seen = JSON.stringify(insp?.last ?? null);
      if (insp && !insp.running && seen !== lastSeen) {
        lastSeen = seen;
        if (insp.last?.ok) viewer.onInspected(insp.last.runId); // show the findings in the visual-inspection view
      }
    }
    if (s && !box.matches(":hover")) render(s);
  }, 2000);
}
