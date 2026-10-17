import type { Package, Profile, Scenario, Size, Zone } from "./types.ts";

/** mulberry32: tiny deterministic PRNG so every seed replays identically. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

const PROFILES: Record<
  Profile,
  { window: number; zones: number[]; sizes: number[]; fragile: number }
> = {
  // Arrivals spread across a 20-minute shift.
  normal: { window: 1200, zones: [0.4, 0.35, 0.25], sizes: [0.5, 0.35, 0.15], fragile: 0.1 },
  // One big truck unloads in 5 minutes.
  peak: { window: 300, zones: [0.4, 0.35, 0.25], sizes: [0.5, 0.35, 0.15], fragile: 0.1 },
  fragile: { window: 1200, zones: [0.4, 0.35, 0.25], sizes: [0.5, 0.35, 0.15], fragile: 0.35 },
  // Held out of train/select: most volume to one zone, more large boxes.
  skewed: { window: 600, zones: [0.7, 0.2, 0.1], sizes: [0.3, 0.3, 0.4], fragile: 0.15 },
};

export function makeScenario(seed: number, profile: Profile, count = 100): Scenario {
  const r = rng(seed * 7919 + profile.length);
  const p = PROFILES[profile];
  const packages: Package[] = [];
  for (let i = 0; i < count; i++) {
    packages.push({
      id: i,
      arrival: Math.round(r() * p.window),
      zone: pick<Zone>(r, ["A", "B", "C"], p.zones),
      size: pick<Size>(r, ["S", "M", "L"], p.sizes),
      fragile: r() < p.fragile,
    });
  }
  packages.sort((a, b) => a.arrival - b.arrival || a.id - b.id);
  return { id: `${profile}-${seed}`, seed, profile, packages };
}

/**
 * train: agents see these. select: the ratchet gate. test: untouched until the
 * final before/after, and it includes the "skewed" profile no agent ever saw.
 */
export const SPLITS = {
  train: [
    { seed: 1, profile: "normal" },
    { seed: 2, profile: "peak" },
    { seed: 3, profile: "fragile" },
  ],
  select: [
    { seed: 101, profile: "normal" },
    { seed: 102, profile: "peak" },
    { seed: 103, profile: "fragile" },
  ],
  test: [
    { seed: 201, profile: "normal" },
    { seed: 202, profile: "peak" },
    { seed: 203, profile: "fragile" },
    { seed: 204, profile: "skewed" },
    { seed: 205, profile: "skewed" },
    { seed: 206, profile: "peak" },
  ],
} satisfies Record<string, { seed: number; profile: Profile }[]>;

export type Split = keyof typeof SPLITS;

export function scenariosFor(split: Split): Scenario[] {
  return SPLITS[split].map((s) => makeScenario(s.seed, s.profile));
}
