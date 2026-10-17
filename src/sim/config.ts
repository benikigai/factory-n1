import type { Size, StationKind } from "./types.ts";

export const SIM = {
  /** Conveyor/AGV speed: seconds to move one grid cell. */
  secondsPerCell: 2,
  service: {
    receiving: 6,
    sorter: 4,
    pack: { S: 20, M: 30, L: 45 } as Record<Size, number>,
    shipping: 5,
  },
  /** A fragile package moved more than this many cells in one leg is damaged. */
  fragileMaxLeg: 12,
  capex: { receiving: 0, sorter: 50_000, pack: 20_000, shipping: 30_000 } as Record<StationKind, number>,
  limits: {
    receiving: [1, 2],
    sorter: [1, 2],
    pack: [1, 8],
    shipping: [1, 3],
  } as Record<StationKind, [number, number]>,
  /** Minimum Chebyshev distance between any two stations (room for aisles). */
  minSpacing: 2,
};

/**
 * Objective weights, in seconds-equivalent. Lower objective is better.
 * One second of makespan is worth $100 of capex, so a $20k pack station
 * must save at least 200 s to pay for itself.
 */
export const OBJECTIVE = {
  missort: 300,
  damaged: 600,
  unshipped: 3600,
  capexPerSecond: 100,
};
