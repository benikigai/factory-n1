import type { ReplayBundle } from '../src/replay.ts';
import type { AgentNode } from './runtime';
export type { ReplayBundle };
export type RunMode = 'recorded' | 'live' | 'simulator' | 'fixture';
export interface BackendEvent { runId: string; ts: number; type: string; [key: string]: unknown }
export interface Experiment {
  candidateId: string; designer: string; model: string; gen: number; decision: string; reason: string;
  rationale?: string; via?: string; toolReceipts?: { id: string; name: string; status: string }[];
  measuredTrain?: {objective: number} | null; measuredSelect?: {objective: number} | null;
}
export interface RunSnapshot {
  id: string; mode: RunMode; state: 'running' | 'complete' | 'error'; revision: string;
  replay: ReplayBundle | null; tree: AgentNode; events: { time: number; agent: string; nodeId: string; message: string; kind: 'start'|'done'|'error'|'info' }[];
  generations: number; stopReason: string; checks: {id: string; description: string; actual: number; passed: boolean}[];
  activePhase: string; error: string | null;
  reservedUsd: number | null;
}
export interface RunEntry {id:string;mode:RunMode;state:RunSnapshot['state'];createdAt:string}
export interface Capabilities {liveReady:boolean;liveReason:string;maxSpendUsd:number;maxCalls:number;backendAvailable:boolean}
