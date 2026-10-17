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
};

const API = "/api/run";

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

export async function mountRunLive(host: HTMLElement) {
  const first = await status();
  if (!first?.available) return; // static hosting or preview: no control at all
  const box = document.createElement("div");
  box.className = "run-live";
  host.append(box);
  const render = (s: Status, note = "") => {
    const presets = Object.entries(s.presets)
      .map(([id, label]) => `<button type="button" data-preset="${id}" ${s.running || !s.configured ? "disabled" : ""}>${label}</button>`)
      .join("");
    const state = s.running
      ? `<span class="rl-dot"></span><a href="./replay.html?run=${s.runId}">${s.runId}</a> running <button type="button" data-stop>Stop</button>`
      : !s.configured
        ? "Set FACTORY_ENV_FILE and restart the dev server to enable live runs."
        : s.last
          ? `Last: <a href="./replay.html?run=${s.last.runId}">${s.last.runId}</a> ${s.last.exitCode === 0 ? "finished" : `stopped: ${s.last.message.replace(/</g, "&lt;")}`}`
          : `Caps per run: ${s.caps.calls} calls, $${s.caps.usd.toFixed(2)}.`;
    box.innerHTML = `<span class="rl-title">Run live on Crusoe</span><span class="rl-presets">${presets}</span><span class="rl-state">${note || state}</span>`;
  };
  render(first);
  box.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    try {
      if (t.dataset.preset) {
        const { runId } = await post(API, { preset: t.dataset.preset });
        location.href = `./replay.html?run=${encodeURIComponent(runId!)}`;
      } else if (t.dataset.stop !== undefined) {
        await post(`${API}/stop`);
      }
    } catch (err) {
      const s = await status();
      if (s) render(s, (err as Error).message);
    }
  });
  setInterval(async () => {
    const s = await status();
    if (s && !box.matches(":hover")) render(s);
  }, 2000);
}
