import { FLOOR_CHECKS, isNumericMetric, type DefinitionOfDone, type DoDCheck } from "../sim/dod.ts";

export const METRIC_NAMES = ["packages", "shipped", "unshipped", "missorts", "damaged", "makespan", "drainTime", "throughputPerHour", "avgCycleTime", "avgWait", "maxQueue", "travelCells", "capex", "objective"] as const;
const MAX_GOAL_CHECKS = 16;

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasOnly = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));

export function sameCheck(a: DoDCheck, b: DoDCheck): boolean {
  return a.metric === b.metric && a.op === b.op && a.value === b.value && a.scope === b.scope;
}

/** Runtime validation happens before a model's JSON can become an executable contract. */
export function definitionErrors(input: unknown, goal?: string, representation: "model" | "canonical" = "model"): string[] {
  if (!object(input)) return ["definition must be an object"];
  const errors: string[] = [];
  if (!hasOnly(input, ["goal", "checks"])) errors.push("definition has unknown fields");
  if (typeof input.goal !== "string" || !input.goal.trim() || /[\r\n]/.test(input.goal)) errors.push("goal must be one nonempty line");
  if (goal !== undefined && input.goal !== goal) errors.push("goal must match the user's exact goal");
  if (!Array.isArray(input.checks)) return [...errors, "checks must be an array"];
  const checks = input.checks;
  // Model responses keep their input cap; sealing may add code-owned floor checks.
  const floorAllowance = representation === "canonical" ? FLOOR_CHECKS.filter((f) => checks.some((c: unknown) => object(c) && c.id === f.id)).length : 0;
  if (!input.checks.length || input.checks.length > MAX_GOAL_CHECKS + floorAllowance) errors.push(`provide 1..${MAX_GOAL_CHECKS} goal-specific checks`);
  const ids = new Set<string>();
  for (const [i, c] of input.checks.entries()) {
    const at = `checks[${i}]`;
    if (!object(c)) { errors.push(`${at} must be an object`); continue; }
    if (!hasOnly(c, ["id", "description", "metric", "op", "value", "scope"])) errors.push(`${at} has unknown fields`);
    if (typeof c.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(c.id)) errors.push(`${at}.id must be a short lowercase identifier`);
    else if (ids.has(c.id)) errors.push(`duplicate check id ${c.id}`);
    else ids.add(c.id);
    if (typeof c.description !== "string" || !c.description.trim() || c.description.length > 500) errors.push(`${at}.description must contain 1..500 characters`);
    if (typeof c.metric !== "string" || !isNumericMetric(c.metric)) errors.push(`${at}.metric is not a grader metric`);
    if (!["<=", ">=", "=="].includes(String(c.op))) errors.push(`${at}.op must be <=, >=, or ==`);
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) errors.push(`${at}.value must be finite`);
    if (!["every", "mean"].includes(String(c.scope))) errors.push(`${at}.scope must be every or mean`);
    const floor = FLOOR_CHECKS.find((f) => f.id === c.id);
    if (floor && !sameCheck(c as unknown as DoDCheck, floor)) errors.push(`${at} attempts to change the non-negotiable ${floor.id} floor`);
  }
  return errors;
}

/** The model cannot remove, replace, or rename away these code-owned checks. */
export function withFloors(dod: DefinitionOfDone): DefinitionOfDone {
  return {
    goal: dod.goal,
    checks: [
      ...FLOOR_CHECKS.map((c) => ({ ...c })),
      ...dod.checks.filter((c) => !FLOOR_CHECKS.some((f) => f.id === c.id)).map((c) => ({ ...c })),
    ],
  };
}

export const DEFINITION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["goal", "checks"],
  properties: {
    goal: { type: "string" },
    checks: {
      type: "array", minItems: 1, maxItems: MAX_GOAL_CHECKS,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "description", "metric", "op", "value", "scope"],
        properties: { id: { type: "string" }, description: { type: "string" }, metric: { type: "string", enum: METRIC_NAMES }, op: { type: "string", enum: ["<=", ">=", "=="] }, value: { type: "number" }, scope: { type: "string", enum: ["every", "mean"] } },
      },
    },
  },
};
