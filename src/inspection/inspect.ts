import type { ChatCompletion } from "openai/resources/chat/completions";
import type { VisualInspection } from "./types.ts";
import { parseJson } from "../llm/crusoe.ts";

export interface ModelFinding {
  title: string;
  observation: string;
  confidence?: string;
  claim?: { metric: string; split: "train" | "select"; baseline: number; champion: number };
  receiptIds?: string[];
}
export interface InspectionAnswer { imageCheck: string; findings: ModelFinding[]; summary: string }

const metrics = new Set(["damaged", "makespan", "travelCells", "objective", "shipped", "missorts"]);
const confidences = new Set(["low", "medium", "high"]);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum;

export function parseInspectionAnswer(content: string | null): InspectionAnswer {
  const value = parseJson<unknown>(content);
  if (!isObject(value) || !isText(value.imageCheck, 128) || !isText(value.summary, 2000) || !Array.isArray(value.findings) || value.findings.length > 8) throw new Error("invalid inspection answer");
  for (const finding of value.findings) {
    if (!isObject(finding) || !isText(finding.title, 200) || !isText(finding.observation, 4000)) throw new Error("invalid finding");
    if (finding.confidence !== undefined && (typeof finding.confidence !== "string" || !confidences.has(finding.confidence))) throw new Error("invalid confidence");
    if (finding.receiptIds !== undefined && (!Array.isArray(finding.receiptIds) || finding.receiptIds.length > 8 || finding.receiptIds.some(id => !isText(id, 200) || !id.length))) throw new Error("invalid receipt references");
    if (finding.claim !== undefined) {
      const claim = finding.claim;
      if (!isObject(claim) || typeof claim.metric !== "string" || !metrics.has(claim.metric) || (claim.split !== "train" && claim.split !== "select") || typeof claim.baseline !== "number" || typeof claim.champion !== "number" || !Number.isFinite(claim.baseline) || !Number.isFinite(claim.champion) || claim.baseline < 0 || claim.champion < 0) throw new Error("invalid numeric claim");
    }
  }
  return value as unknown as InspectionAnswer;
}

/** Only exact numeric claims backed by a successful comparison get a supported label. */
export function verifyFindings(answer: InspectionAnswer, receipts: VisualInspection["toolReceipts"]): VisualInspection["findings"] {
  return answer.findings.map((finding, index) => {
    const result: VisualInspection["findings"][number] = {
      id: `finding-${index + 1}`, title: finding.title, observation: finding.observation,
      frameId: "comparison", confidence: finding.confidence,
      verification: { status: "not_tested", summary: "Visual interpretation or causal explanation; not established by the numeric tools." },
    };
    if (!finding.claim) return result;
    const claim = finding.claim;
    const references = Array.isArray(finding.receiptIds) ? finding.receiptIds : [];
    const candidates = receipts.filter(r => r.status === "ok" && r.name === "compare_layouts" && (r.output as { split?: unknown } | null)?.split === claim.split);
    const exact = candidates.filter(r => references.includes(r.id));
    // A descriptive reference is recoverable only if it identifies one recorded call.
    const matches = exact.length ? exact : references.includes(`compare_layouts ${claim.split}`) ? candidates : [];
    const receipt = matches.length === 1 ? matches[0] : undefined;
    if (!receipt) return result;
    const measured = receipt.output as { baseline?: { mean?: Record<string, number> }; champion?: { mean?: Record<string, number> } };
    const baseline = measured.baseline?.mean?.[claim.metric], champion = measured.champion?.mean?.[claim.metric];
    if (typeof baseline !== "number" || typeof champion !== "number") return result;
    if (!Number.isFinite(baseline) || !Number.isFinite(champion)) return result;
    const matched = Math.abs(baseline - claim.baseline) < 0.011 && Math.abs(champion - claim.champion) < 0.011;
    result.verification = {
      status: matched ? "supported" : "refuted", receiptIds: [receipt.id],
      summary: `Numeric check only: mean ${claim.metric} is ${baseline} → ${champion} on ${claim.split} development days. ${matched ? "The numbers match." : "The claimed numbers do not match."} Visual or causal explanations remain hypotheses.`,
    };
    return result;
  });
}

/** Logs only response payloads, never the SDK's request object, headers or environment. */
export function responseRecord(response: ChatCompletion) {
  return { id: response.id, model: response.model, created: response.created, choices: response.choices, usage: response.usage };
}
