import { auditGoal, AUDITOR_MODEL, type GoalAudit } from "../agents/auditor.ts";
import { planGoal, PLANNER_MODEL, type GoalChat } from "../agents/planner.ts";
import type { Scenario } from "../sim/types.ts";
import type { Task } from "../tasks/task.ts";
import { assessFeasibility, dropFloorRedundancies, physicalBounds, vacuityErrors, type Feasibility } from "./feasibility.ts";
import { sealDoD, tighteningErrors, type ApprovedDoD } from "./lattice.ts";
import { withFloors } from "./schema.ts";

/** Serializable evidence contract consumed by CLI artifacts and static replay pages. */
export interface GoalCompilation {
  schemaVersion: 1;
  status: "approved" | "rejected" | "escalate";
  goal: string;
  models: { planner: string; auditor: string };
  planner: { attempts: number; errors: string[] };
  audit: GoalAudit | null;
  feasibility: Feasibility;
  approved: ApprovedDoD | null;
  reasons: string[];
}

export async function compileGoal(opts: { goal: string; task: Task; scenarios: Scenario[]; call?: GoalChat; previous?: ApprovedDoD }): Promise<GoalCompilation> {
  const base: GoalCompilation = { schemaVersion: 1, status: "rejected", goal: opts.goal, models: { planner: PLANNER_MODEL, auditor: AUDITOR_MODEL }, planner: { attempts: 0, errors: [] }, audit: null, feasibility: { status: "not-ruled-out", bounds: [], violations: [] }, approved: null, reasons: [] };
  if (!opts.goal.trim() || /[\r\n]/.test(opts.goal) || opts.goal.length > 1000) return { ...base, reasons: ["goal must be one nonempty line, at most 1000 characters"] };
  let bounds;
  try { bounds = physicalBounds(opts.task, opts.scenarios); }
  catch (e) { return { ...base, status: "escalate", reasons: [`Physical contract error: ${e instanceof Error ? e.message : String(e)}`] }; }
  base.feasibility.bounds = bounds;
  const planned = await planGoal({ goal: opts.goal, call: opts.call,
    context: `Scenario package counts: ${opts.scenarios.map((s) => `${s.id}=${s.packages.length}`).join(", ")}.`,
    validate: (dod) => {
      const normalized = dropFloorRedundancies(withFloors(dod), bounds);
      return [...vacuityErrors(normalized, bounds), ...(opts.previous ? tighteningErrors(opts.previous, normalized) : [])];
    },
  });
  base.planner = { attempts: planned.attempts, errors: planned.errors };
  if (!planned.dod) return { ...base, reasons: planned.errors };
  const dod = dropFloorRedundancies(withFloors(planned.dod), bounds);
  base.feasibility = assessFeasibility(dod, bounds);
  if (base.feasibility.status === "infeasible") return { ...base, status: "escalate", reasons: base.feasibility.violations.map((v) => v.proof) };
  base.audit = await auditGoal(opts.goal, dod, opts.call);
  if (base.audit.verdict === "veto") return { ...base, reasons: base.audit.reasons };
  return { ...base, status: "approved", approved: sealDoD(dod), reasons: [] };
}
