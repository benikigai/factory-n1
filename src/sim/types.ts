export type Zone = "A" | "B" | "C";
export type Size = "S" | "M" | "L";
export const ZONES: Zone[] = ["A", "B", "C"];
export const SIZES: Size[] = ["S", "M", "L"];

export interface Package {
  id: number;
  /** Seconds after the shift starts that the package reaches the receiving dock. */
  arrival: number;
  size: Size;
  zone: Zone;
  fragile: boolean;
}

export type StationKind = "receiving" | "sorter" | "pack" | "shipping";

export interface Station {
  id: string;
  kind: StationKind;
  x: number;
  y: number;
  /** pack: zones it accepts. shipping: zones the dock serves. */
  zones?: Zone[];
  /** pack: package sizes it accepts. */
  sizes?: Size[];
}

/** The artifact agents edit. Plain JSON so a model can read and rewrite it. */
export interface Layout {
  name: string;
  grid: { w: number; h: number };
  stations: Station[];
}

export type Profile = "normal" | "peak" | "fragile" | "skewed";

export interface Scenario {
  id: string;
  seed: number;
  profile: Profile;
  packages: Package[];
}

export interface StationStats {
  kind: StationKind;
  processed: number;
  utilization: number;
  maxQueue: number;
  totalWait: number;
}

export interface RunMetrics {
  packages: number;
  shipped: number;
  unshipped: number;
  missorts: number;
  damaged: number;
  /** Seconds from first arrival to last shipment. */
  makespan: number;
  /** Seconds from the last arrival until the floor is clear. */
  drainTime: number;
  throughputPerHour: number;
  avgCycleTime: number;
  avgWait: number;
  maxQueue: number;
  travelCells: number;
  capex: number;
  /** Lower is better. Single number the ratchet compares. */
  objective: number;
  bottleneck: string;
  stations: Record<string, StationStats>;
}

export interface PackageTrace {
  id: number;
  zone: Zone;
  size: Size;
  fragile: boolean;
  arrival: number;
  shippedAt: number | null;
  damaged: boolean;
  missorted: boolean;
  /** Time spent at each station: queue entry, service start, service end. */
  steps: { station: string; enter: number; start: number; end: number }[];
  /** Moves between stations; the 3D view interpolates along these. */
  legs: { from: string; to: string; t0: number; t1: number; cells: number }[];
}

export interface RunResult {
  scenario: { id: string; seed: number; profile: Profile };
  metrics: RunMetrics;
  trace: PackageTrace[];
}
