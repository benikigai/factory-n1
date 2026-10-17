import { SIM } from "./config.ts";
import { SIZES, ZONES, type Layout, type Station, type StationKind } from "./types.ts";

export function onPerimeter(s: Station, grid: Layout["grid"]): boolean {
  return s.x === 0 || s.y === 0 || s.x === grid.w - 1 || s.y === grid.h - 1;
}

export function distance(a: Station, b: Station): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Hard constraints. A layout that fails any of these is rejected before
 * simulation, and the errors are fed back to the agent verbatim.
 */
export function validateLayout(layout: Layout): string[] {
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
