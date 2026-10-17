import { createHash } from "node:crypto";
import type { DefinitionOfDone, DoDCheck, NumericMetric } from "../sim/dod.ts";
import { definitionErrors, withFloors } from "./schema.ts";

export interface ApprovedDoD { hash: string; dod: DefinitionOfDone }

export function hashDoD(dod: DefinitionOfDone): string {
  const ordered = [...dod.checks].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ id: c.id, description: c.description, metric: c.metric, op: c.op, value: c.value, scope: c.scope }));
  return createHash("sha256").update(JSON.stringify({ goal: dod.goal, checks: ordered })).digest("hex");
}

function interval(dod: DefinitionOfDone, metric: NumericMetric, scope: DoDCheck["scope"]): [number, number] {
  let lo = -Infinity, hi = Infinity;
  for (const c of withFloors(dod).checks.filter((c) => c.metric === metric && (scope === "mean" || c.scope === "every"))) {
    if (c.op === ">=" || c.op === "==") lo = Math.max(lo, c.value);
    if (c.op === "<=" || c.op === "==") hi = Math.min(hi, c.value);
  }
  return [lo, hi];
}

function implies(candidate: DefinitionOfDone, previous: DefinitionOfDone): boolean {
  return withFloors(previous).checks.every((c) => {
    const [lo, hi] = interval(candidate, c.metric, c.scope);
    return (c.op === "<=" ? hi <= c.value : c.op === ">=" ? lo >= c.value : lo === c.value && hi === c.value);
  });
}

export function tighteningErrors(previous: ApprovedDoD, candidate: DefinitionOfDone): string[] {
  const priorErrors = definitionErrors(previous.dod, undefined, "canonical");
  if (priorErrors.length) return ["approved DoD schema was edited", ...priorErrors];
  if (hashDoD(previous.dod) !== previous.hash) return ["approved DoD hash mismatch: the prior contract was edited"];
  const errors = definitionErrors(candidate, undefined, "canonical");
  if (errors.length) return errors;
  if (candidate.goal !== previous.dod.goal) errors.push("a tightened contract must retain the approved goal");
  if (!implies(candidate, previous.dod)) errors.push("candidate weakens or drops an approved bound or changes every to mean");
  if (implies(previous.dod, candidate)) errors.push("later edits must be strictly tighter; renaming, rewording, or equivalent bounds do not qualify");
  for (const c of candidate.checks) {
    const [lo, hi] = interval(candidate, c.metric, c.scope);
    if (lo > hi) { errors.push(`contradictory bounds for ${c.metric} (${c.scope})`); break; }
  }
  return errors;
}

export function sealDoD(dod: DefinitionOfDone): ApprovedDoD {
  const errors = definitionErrors(dod, undefined, "canonical");
  if (errors.length) throw new Error(errors.join("; "));
  const frozen = withFloors(dod);
  frozen.checks.forEach(Object.freeze);
  Object.freeze(frozen.checks);
  Object.freeze(frozen);
  return Object.freeze({ hash: hashDoD(frozen), dod: frozen });
}

export function assertApprovedDoD(approved: ApprovedDoD): DefinitionOfDone {
  const errors = definitionErrors(approved.dod, undefined, "canonical");
  if (errors.length || hashDoD(approved.dod) !== approved.hash) throw new Error(`approved DoD integrity check failed: ${errors.join("; ") || "hash mismatch"}`);
  return withFloors(approved.dod);
}
