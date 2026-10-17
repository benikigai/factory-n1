import { createHash } from "node:crypto";
import { DEFAULT_DOD } from "../sim/dod.ts";
import { rng } from "../sim/scenarios.ts";
import type { Layout, Station, Zone } from "../sim/types.ts";
import { validateForTask, type Task } from "../tasks/task.ts";

export const contentHash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

export function layoutHash(layout: Layout) {
  return contentHash({ grid: layout.grid, stations: [...layout.stations].sort((a, b) => a.id.localeCompare(b.id)).map(s => ({ ...s, zones: s.zones && [...s.zones].sort(), sizes: s.sizes && [...s.sizes].sort() })) });
}

export function buildingHash(task: Task) {
  const { w, h } = task.initial.grid;
  const forms: string[] = [];
  for (const transpose of [false, true]) for (const mirrorX of [false, true]) for (const mirrorY of [false, true]) {
    const stations = task.initial.stations.filter(s => task.fixed.includes(s.id)).map(s => {
      const x = mirrorX ? w - 1 - s.x : s.x, y = mirrorY ? h - 1 - s.y : s.y;
      return { ...s, x: transpose ? y : x, y: transpose ? x : y };
    }).sort((a, b) => a.id.localeCompare(b.id));
    forms.push(JSON.stringify({ grid: transpose ? { w: h, h: w } : { w, h }, stations }));
  }
  return contentHash(forms.sort()[0]);
}

/** New rectangular buildings; no historical layout or held-out factory is read. */
export function generateBuilding(seed: number, id: string, missingDockZone = false): Task {
  const random = rng(seed);
  const integer = (n: number) => Math.floor(random() * n);
  const w = 18 + integer(7), h = 12 + integer(7), cy = Math.floor((h - 1) / 2);
  const sx = Math.min(11, Math.floor(w / 2));
  const px = Math.floor((sx + w - 1) / 2);
  const zones: Zone[] = ["A", "B", "C"];
  for (let i = zones.length - 1; i > 0; i--) { const j = integer(i + 1); [zones[i], zones[j]] = [zones[j], zones[i]]; }
  const ys = [2, cy, h - 4];
  const stations: Station[] = [{ id: "recv-1", kind: "receiving", x: 0, y: cy + integer(3) - 1 }, { id: "sort-1", kind: "sorter", x: sx, y: cy }];
  zones.forEach((zone, i) => {
    stations.push({ id: `ship-${zone}`, kind: "shipping", x: w - 1, y: ys[i], zones: [missingDockZone && zone === "C" ? "B" : zone] });
    for (let j = 0; j < 2; j++) stations.push({ id: `pack-${zone}-${j + 1}`, kind: "pack", x: px - 2 * j, y: ys[i], zones: [zone], sizes: ["S", "M", "L"] });
  });
  const mirrorX = random() < 0.5, mirrorY = random() < 0.5, transpose = random() < 0.5;
  for (const station of stations) {
    if (mirrorX) station.x = w - 1 - station.x;
    if (mirrorY) station.y = h - 1 - station.y;
    if (transpose) [station.x, station.y] = [station.y, station.x];
  }
  const initial: Layout = { name: "candidate", grid: transpose ? { w: h, h: w } : { w, h }, stations };
  const task: Task = { id, goal: DEFAULT_DOD.goal, initial, fixed: stations.filter(s => s.kind === "receiving" || s.kind === "shipping").map(s => s.id), editable: { sorter: [1, 2], pack: [2, 6] }, capexCap: 300_000 };
  const errors = validateForTask(initial, task);
  if (errors.length) throw new Error(`Generated building is invalid: ${errors.join("; ")}`);
  return task;
}

export type CandidateFamily = "capacity" | "fewer-packs" | "random" | "size-gap" | "zone-gap" | "invalid-spacing" | "invalid-fixed-dock" | "invalid-count";

/** Stratified proposals retain difficult cases without labeling quality in model inputs. */
export function generateCandidate(task: Task, seed: number, index: number): { layout: Layout; family: CandidateFamily } {
  const random = rng(seed), integer = (n: number) => Math.floor(random() * n);
  const layout = structuredClone(task.initial);
  const mode = index % 20;
  let family: CandidateFamily;
  const packs = () => layout.stations.filter(s => s.kind === "pack");
  if (mode < 4) {
    family = "capacity";
    if (mode > 0) {
      const selected = packs()[integer(packs().length)];
      selected.x += integer(3) - 1;
      selected.y += integer(3) - 1;
    }
  } else if (mode < 8) {
    family = "fewer-packs";
    layout.stations = layout.stations.filter(s => s.kind !== "pack" || s.id.endsWith("-1") || (mode === 7 && s.id === "pack-A-2"));
    const selected = packs()[integer(packs().length)];
    selected.x += integer(3) - 1;
    selected.y += integer(3) - 1;
  } else if (mode < 14) {
    family = "random";
    layout.stations = layout.stations.filter(s => s.kind === "receiving" || s.kind === "shipping");
    const nSorters = 1 + integer(2), nPacks = 2 + integer(5);
    for (const kind of ["sorter", "pack"] as const) {
      const count = kind === "sorter" ? nSorters : nPacks;
      for (let i = 0; i < count; i++) {
        let placed = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const station: Station = { id: `${kind}-${i + 1}`, kind, x: 1 + integer(layout.grid.w - 2), y: 1 + integer(layout.grid.h - 2), ...(kind === "pack" ? { zones: ["A", "B", "C"] as Zone[], sizes: ["S", "M", "L"] as Station["sizes"] } : {}) };
          if (layout.stations.every(s => Math.max(Math.abs(s.x - station.x), Math.abs(s.y - station.y)) >= 2)) { layout.stations.push(station); placed = true; break; }
        }
        if (!placed) throw new Error("Could not place candidate station");
      }
    }
  } else if (mode < 17) {
    family = mode === 15 ? "zone-gap" : "size-gap";
    for (const station of packs()) {
      if (family === "size-gap") station.sizes = mode === 14 ? ["S", "M"] : ["S"];
      else station.zones = ["A", "B"];
    }
  } else if (mode === 17) {
    family = "invalid-spacing";
    const [first, second] = packs(); second.x = first.x; second.y = first.y;
  } else if (mode === 18) {
    family = "invalid-fixed-dock";
    const dock = layout.stations.find(s => s.kind === "receiving")!; dock.x = Math.floor(layout.grid.w / 2); dock.y = Math.floor(layout.grid.h / 2);
  } else {
    family = "invalid-count";
    layout.stations.push({ id: "pack-extra", kind: "pack", x: 1, y: 1, zones: ["A", "B", "C"], sizes: ["S", "M", "L"] });
  }
  return { layout, family };
}
