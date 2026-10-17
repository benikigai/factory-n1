import type { ReplaySide } from '../src/replay.ts';
import type { Layout, Profile } from '../src/sim/types.ts';
import type { OptimizerMeasurement } from '../src/training/optimizer.ts';
import type { V2Arm, V2Model, V2ModelProvenance } from '../src/training/optimizer-v2-evaluate.ts';

export const MODELS: V2Model[] = ['factory-optimizer-base', 'factory-optimizer-v1', 'factory-optimizer-old3', 'factory-optimizer-v2'];
export const BASELINES: V2Arm[] = ['random', 'geometric-teacher'];
export const LABELS: Record<V2Arm, string> = {
  'factory-optimizer-base': 'Base Nemotron 8B',
  'factory-optimizer-v1': 'Original optimizer',
  'factory-optimizer-old3': 'Original data control',
  'factory-optimizer-v2': 'Goal curriculum',
  random: 'Seeded legal random moves',
  'geometric-teacher': 'Privileged geometric planner',
};
export function modelLabel(model: V2Model, models: Partial<Record<V2Model, V2ModelProvenance>>) {
  const epochs = models[model]?.epochs;
  return model === 'factory-optimizer-base' || epochs === undefined ? LABELS[model] : `${LABELS[model]} · ${epochs} epoch${epochs === 1 ? '' : 's'}`;
}
export type Snapshot = 'round3' | 'round12';
export type Metrics = NonNullable<OptimizerMeasurement['metrics']>;
export interface SnapshotScore { metrics: Metrics; goalMet: boolean; zeroDamage: boolean }
export interface ArmScore {
  snapshots: Record<Snapshot, SnapshotScore>;
  accepted: number;
  invalid: number;
  attempted: number;
  stopped: boolean;
  planningSimulations: number;
  planningMs: number;
}
export interface Factory {
  id: string;
  buildingHash: string;
  initial: Layout;
  initialScore: SnapshotScore;
  arms: Record<V2Arm, ArmScore>;
  v2VsBasePercent: number;
  replays: { profile: Profile; seed: number; file: string }[];
}
export interface Aggregate {
  meanObjective: number;
  meanDamaged: number;
  goalPasses: number;
  zeroDamage: number;
  improvements: number;
}
export interface Cohort {
  kind: 'completed' | 'continuation' | 'interrupted';
  originalFactories: number;
  includedFactories: number;
  excludedFactories: { id: string; reason: string }[];
  disclosure: string;
  originalResolvedRequests?: number;
  originalUnknownRequests?: number;
  combinedModelCalls?: number;
}
export interface V2Catalog {
  schemaVersion: 2;
  mode: 'recorded' | 'synthetic';
  createdAt: string;
  graderHash: string;
  simVersion: string;
  defaultCaseId: string;
  selectionRule: string;
  scope: string;
  cases: Factory[];
  models: Partial<Record<V2Model, V2ModelProvenance>>;
  aggregate: Record<V2Arm, Record<Snapshot, Aggregate>> | null;
  sourceHashes: Record<string, string>;
  cohort: Cohort;
}
export interface V2Replay {
  caseId: string;
  scenario: { id: string; seed: number; profile: string };
  initial: ReplaySide;
  arms: Record<V2Model, Record<Snapshot, ReplaySide>>;
}
