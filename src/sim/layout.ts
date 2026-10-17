import { SIM } from "./config.ts";
import { SIZES, ZONES, type Layout, type Station, type StationKind } from "./types.ts";

export function onPerimeter(s: Station, grid: Layout["grid"]): boolean {
  return s.x === 0 || s.y === 0 || s.x === grid.w - 1 || s.y === grid.h - 1;
}

export function distance(a: Station, b: Station): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const KINDS: StationKind[] = ["receiving", "sorter", "pack", "shipping"];

/** Runtime shape check: model output is untrusted JSON, not a typed Layout. */
export function schemaErrors(input: unknown): string[] {
  const l = input as Layout;
  if (!l || typeof l !== "object") return ["layout must be a JSON object"];
  if (!l.grid || !Number.isInteger(l.grid.w) || !Number.isInteger(l.grid.h)) return ["grid must be {w,h} integers"];
  if (!Array.isArray(l.stations)) return ["stations must be an array"];
  const errors: string[] = [];
  l.stations.forEach((s, i) => {
    if (!s || typeof s !== "object") return errors.push(`stations[${i}] must be an object`);
    if (typeof s.id !== "string" || !s.id) errors.push(`stations[${i}].id must be a non-empty string`);
    if (!KINDS.includes(s.kind)) errors.push(`stations[${i}].kind must be one of ${KINDS.join(", ")}`);
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y)) errors.push(`stations[${i}] x,y must be integers`);
    if (s.zones !== undefined && !Array.isArray(s.zones)) errors.push(`stations[${i}].zones must be an array`);
    if (s.sizes !== undefined && !Array.isArray(s.sizes)) errors.push(`stations[${i}].sizes must be an array`);
  });
  return errors;
}

/**
 * Hard constraints. A layout that fails any of these is rejected before
 * simulation, and the errors are fed back to the agent verbatim.
 */
export function validateLayout(layout: Layout): string[] {
  const shape = schemaErrors(layout);
  if (shape.length) return shape;
  const errors: string[] = [];
  const { grid, stations } = layout;
  if (!grid || grid.w < 8 || grid.h < 8 || grid.w > 40 || grid.h > 40) {
    errors.push("grid must be between 8x8 and 40x40");
    return errors;
  }
  const ids = new Set<string>();
  for (const s of stations) {
    if (ids.has(s.id)) errors.push(`duplicate station id ${s.id}`);
    ids.add(s.id);
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y) || s.x < 0 || s.y < 0 || s.x >= grid.w || s.y >= grid.h) {
      errors.push(`${s.id} at (${s.x},${s.y}) is outside the ${grid.w}x${grid.h} grid`);
    }
    if ((s.kind === "receiving" || s.kind === "shipping") && !onPerimeter(s, grid)) {
      errors.push(`${s.id} is a dock and must sit on the outer wall`);
    }
    if (s.kind === "pack") {
      if (!s.zones?.length || s.zones.some((z) => !ZONES.includes(z))) errors.push(`${s.id} needs zones from A,B,C`);
      if (!s.sizes?.length || s.sizes.some((z) => !SIZES.includes(z))) errors.push(`${s.id} needs sizes from S,M,L`);
    }
    if (s.kind === "shipping" && (!s.zones?.length || s.zones.some((z) => !ZONES.includes(z)))) {
      errors.push(`${s.id} needs zones from A,B,C`);
    }
  }
  for (const kind of Object.keys(SIM.limits) as StationKind[]) {
    const n = stations.filter((s) => s.kind === kind).length;
    const [lo, hi] = SIM.limits[kind];
    if (n < lo || n > hi) errors.push(`need ${lo}-${hi} ${kind} stations, found ${n}`);
  }
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i];
      const b = stations[j];
      if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < SIM.minSpacing) {
        errors.push(`${a.id} and ${b.id} are closer than ${SIM.minSpacing} cells`);
      }
    }
  }
  return errors;
}
