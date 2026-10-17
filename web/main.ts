/**
 * Factory N+1 replay viewer. Loads /runs/<runId>/replay.json and plays the scored
 * baseline and improved traces side by side on one clock.
 */
import type { ReplayBundle } from "../src/replay.ts";
import { createControls, type Playback } from "./ui/controls.ts";
import { renderHud, renderLegend, renderRail, type CounterEls } from "./ui/panel.ts";
import { createWarehouse } from "./world/warehouse.ts";
import { playbackEnd } from "./world/state.ts";

const params = new URLSearchParams(location.search);
const rawRun = params.get("run") || "live-a-5";
const runId = /^[A-Za-z0-9._-]+$/.test(rawRun) && !rawRun.startsWith(".") ? rawRun : "live-a-5";
const url = `/runs/${encodeURIComponent(runId)}/replay.json`;

const $ = (id: string) => document.getElementById(id)!;
const errorEl = $("error");
function showError(msg: string | null) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg ?? "";
}

const world = createWarehouse($("scene"));
const playback: Playback = { t: 0, end: 1, playing: true, speed: 16 };
let counters: CounterEls | null = null;

const controls = createControls($("controls"), playback, {
  seek(t) {
    playback.t = Math.max(0, Math.min(playback.end, t));
  },
  toggle() {
    playback.playing = !playback.playing;
  },
  speed(s) {
    playback.speed = s;
  },
  camera(name) {
    world.preset(name);
  },
});
renderLegend($("legend"));

let lastText = "";
function apply(bundle: ReplayBundle) {
  renderHud($("mode-badge"), $("hud-meta"), bundle);
  counters = renderRail($("rail"), bundle);
  world.setBundle(bundle);
  playback.end = Math.max(1, playbackEnd(bundle.baseline.result.trace, bundle.improved.result.trace));
  playback.t = Math.min(playback.t, playback.end);
  controls.setEnd(playback.end);
  controls.setCloseupLabel(world.closeupTarget());
  document.title = `Factory N+1 · ${bundle.runId} · ${bundle.mode}`;
}

async function load(): Promise<ReplayBundle | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const text = await res.text();
  if (text === lastText) return null;
  const bundle = JSON.parse(text) as ReplayBundle;
  lastText = text;
  return bundle;
}

let pollTimer: number | undefined;
function setPolling(on: boolean) {
  if (on && pollTimer === undefined) {
    pollTimer = window.setInterval(async () => {
      try {
        const b = await load();
        showError(null);
        if (b) {
          apply(b);
          setPolling(b.mode === "live");
        }
      } catch (e) {
        showError(`Live reload failed: ${(e as Error).message}`);
      }
    }, 2000);
  } else if (!on && pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

load()
  .then((b) => {
    if (!b) return;
    apply(b);
    setPolling(b.mode === "live");
  })
  .catch((e) => showError(`Could not load run "${runId}": ${(e as Error).message}. Try ?run=sample (npm run sample).`));

let last = performance.now();
let lastUi = 0;
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playback.playing) {
    playback.t += dt * playback.speed;
    if (playback.t > playback.end) playback.t = 0; // loop
  }
  const frames = world.render(playback.t, now / 1000);
  if (frames && now - lastUi > 100) {
    lastUi = now;
    const [a, b] = frames;
    const n = (f: typeof a) => f.views.length;
    world.setCounters(
      `shipped ${a.shipped}/${n(a)} · queue ${a.queued} · damaged ${a.damaged}`,
      `shipped ${b.shipped}/${n(b)} · queue ${b.queued} · damaged ${b.damaged}`,
    );
    counters?.update(a, b);
    controls.sync(playback);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
