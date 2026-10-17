export interface VisualInspection {
  schemaVersion: 1;
  runId: string;
  recordedAt: string;
  model: string;
  provider: string;
  graderHash: string;
  imageInput: {
    verified: boolean;
    method: string;
    details: string;
    challenge?: { expected: string; observed: string; matched: boolean };
    requestId?: string;
    imageSha256?: string;
  };
  frames: { id: string; label: string; path: string; side?: string; simulationTime?: number }[];
  findings: {
    id: string;
    title: string;
    observation: string;
    frameId?: string;
    confidence?: string;
    verification: { status: "supported" | "refuted" | "not_tested"; summary: string; receiptIds?: string[] };
  }[];
  toolReceipts: { id: string; name: string; status: string; input: unknown; output: unknown; durationMs?: number }[];
  budget?: { calls: number; usd: number; reservedUsd: number };
  trainingDataPath?: string;
  notes?: string[];
}
