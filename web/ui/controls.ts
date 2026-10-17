/** Playback bar: one clock shared by both floors. */
import { fmtTime, h } from "./dom.ts";

export const SPEEDS = [1, 4, 16, 60, 120];

export interface Playback {
  t: number;
  end: number;
  playing: boolean;
  speed: number;
}

export interface Controls {
  setEnd(end: number): void;
  sync(p: Playback): void;
  setCloseupLabel(id: string | null): void;
}

export function createControls(
  root: HTMLElement,
  p: Playback,
  on: { seek(t: number): void; toggle(): void; speed(s: number): void; camera(name: "overview" | "closeup"): void },
): Controls {
  const play = h("button", { class: "btn play", title: "Play / pause (space)" }, "Pause");
  play.addEventListener("click", () => on.toggle());

  const speed = h("select", { class: "speed", title: "Playback speed (sim seconds per real second)" },
    SPEEDS.map((s) => h("option", { value: String(s), selected: s === p.speed }, `${s}×`)),
  );
  speed.addEventListener("change", () => on.speed(Number(speed.value)));

  const scrub = h("input", { type: "range", class: "scrub", min: "0", max: String(p.end), step: "0.5", value: "0" });
  let scrubbing = false;
  scrub.addEventListener("input", () => {
    scrubbing = true;
    on.seek(Number(scrub.value));
  });
  scrub.addEventListener("change", () => (scrubbing = false));
  scrub.addEventListener("pointerup", () => (scrubbing = false));

  const clock = h("span", { class: "clock", title: "Sim clock (shared by both floors)" }, "00:00");
  const endLbl = h("span", { class: "clock-end" }, "/ 00:00");

  const overview = h("button", { class: "btn" }, "Overview");
  overview.addEventListener("click", () => on.camera("overview"));
  const closeup = h("button", { class: "btn" }, "Close-up");
  closeup.addEventListener("click", () => on.camera("closeup"));

  root.replaceChildren(
    play,
    speed,
    h("span", { class: "clock-wrap" }, h("span", { class: "k" }, "sim t "), clock, endLbl),
    scrub,
    h("span", { class: "cams" }, overview, closeup),
  );

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      on.toggle();
    }
  });

  let lastClock = "";
  return {
    setEnd(end) {
      scrub.max = String(end);
      endLbl.textContent = `/ ${fmtTime(end)}`;
    },
    sync(state) {
      const label = state.playing ? "Pause" : "Play";
      if (play.textContent !== label) play.textContent = label;
      if (speed.value !== String(state.speed)) speed.value = String(state.speed);
      if (!scrubbing) scrub.value = String(state.t);
      const c = fmtTime(state.t);
      if (c !== lastClock) {
        clock.textContent = c;
        lastClock = c;
      }
    },
    setCloseupLabel(id) {
      closeup.textContent = id ? `Close-up: ${id}` : "Close-up";
      closeup.title = id ? `Improved floor's bottleneck station (${id})` : "";
    },
  };
}
