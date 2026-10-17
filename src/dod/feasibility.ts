import { OBJECTIVE, SIM } from "../sim/config.ts";
import type { DefinitionOfDone, DoDCheck, NumericMetric } from "../sim/dod.ts";
import { distance } from "../sim/layout.ts";
import type { Scenario } from "../sim/types.ts";
import type { Task } from "../tasks/task.ts";
import { sameCheck } from "./schema.ts";
import { FLOOR_CHECKS } from "../sim/dod.ts";

export interface MetricBound {
  scenarioId: string;
  metric: NumericMetric;
  lower: number;
  upper: number | null;
  proof: string[];
}
export interface Feasibility {
  status: "not-ruled-out" | "infeasible";
  bounds: MetricBound[];
  violations: { checkId: string; scenarioIds: string[]; proof: string }[];
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Bounds use only immutable service times, task capacity, arrivals, and fixed docks. No model or candidate layout. */
export function physicalBounds(task: Task, scenarios: Scenario[]): MetricBound[] {
  if (!scenarios.length || scenarios.some((s) => !s.packages.length)) throw new Error("feasibility requires nonempty scenarios");
  const receiving = task.initial.stations.filter((s) => s.kind === "receiving");
  const shipping = task.initial.stations.filter((s) => s.kind === "shipping");
  if (!receiving.length || !shipping.length) throw new Error("task requires fixed receiving and shipping docks");
  const sorterMax = Math.min(task.editable.sorter[1], SIM.limits.sorter[1]);
  const packMax = Math.min(task.editable.pack[1], SIM.limits.pack[1]);
  if (sorterMax < 1 || packMax < 1) throw new Error("task has no legal processing capacity");
  const capexMin = [...receiving, ...shipping].reduce((n, s) => n + SIM.capex[s.kind], 0)
    + Math.max(task.editable.sorter[0], SIM.limits.sorter[0]) * SIM.capex.sorter
    + Math.max(task.editable.pack[0], SIM.limits.pack[0]) * SIM.capex.pack;
  const transitMin = 3 * SIM.minSpacing * SIM.secondsPerCell;
  const serviceMin = SIM.service.receiving + SIM.service.sorter + Math.min(...Object.values(SIM.service.pack)) + SIM.service.shipping;
  return scenarios.flatMap((scenario): MetricBound[] => {
    const packages = [...scenario.packages].sort((a, b) => a.arrival - b.arrival);
    const n = packages.length;
    const first = packages[0].arrival, last = packages[n - 1].arrival;
    const cells = packages.map((p) => {
      const docks = shipping.filter((s) => s.zones?.includes(p.zone));
      if (!docks.length) throw new Error(`no fixed shipping dock covers zone ${p.zone}`);
      return Math.max(3 * SIM.minSpacing, Math.min(...receiving.flatMap((r) => docks.map((s) => distance(r, s)))));
    });
    const chains = packages.map((p, i) => SIM.service.receiving + SIM.service.sorter + SIM.service.pack[p.size] + SIM.service.shipping + cells[i] * SIM.secondsPerCell);
    const arrivalBound = Math.max(...packages.map((p, i) => p.arrival + chains[i])) - first;
    const afterReceive = serviceMin - SIM.service.receiving + transitMin;
    const receivingBound = Math.max(...packages.map((p, i) => p.arrival - first + Math.ceil((n - i) / receiving.length) * SIM.service.receiving + afterReceive));
    const sorterBound = n * SIM.service.sorter / sorterMax + serviceMin - SIM.service.sorter + transitMin;
    const packWork = packages.reduce((sum, p) => sum + SIM.service.pack[p.size], 0);
    const packBound = packWork / packMax + serviceMin - Math.min(...Object.values(SIM.service.pack)) + transitMin;
    const shippingBound = n * SIM.service.shipping / shipping.length + serviceMin - SIM.service.shipping + transitMin;
    const makespan = Math.max(arrivalBound, receivingBound, sorterBound, packBound, shippingBound);
    const proof = [
      `Makespan is last shipment minus first arrival (${first}s); last arrival is ${last}s.`,
      `Each package needs receiving ${SIM.service.receiving}s + sorting ${SIM.service.sorter}s + size-specific packing + shipping ${SIM.service.shipping}s; three transfers need at least ${transitMin}s and at least the fixed-dock Manhattan distance. Arrival/service-chain bound: ${arrivalBound}s.`,
      `${receiving.length} fixed receiving dock(s) at ${SIM.service.receiving}s/package, including every suffix of arrivals and the remaining service chain: ${receivingBound}s.`,
      `Work/capacity plus minimum preceding and remaining service: sorters ${sorterBound}s (max ${sorterMax}), packing ${packBound}s (max ${packMax}), shipping ${shippingBound}s (${shipping.length} fixed).`,
      `These optimistic lower bounds ignore queues and placement conflicts; passing them does not prove a layout exists.`,
    ];
    const b = (metric: NumericMetric, lower: number, upper: number | null, why: string[]): MetricBound => ({ scenarioId: scenario.id, metric, lower, upper, proof: why });
    const invariant = ["All-shipped floor is imposed by code; package count and arrival identity are fixed by the scenario."];
    return [
      b("makespan", makespan, null, proof), b("drainTime", makespan + first - last, null, proof),
      b("throughputPerHour", 0, round(n / makespan * 3600), [...proof, "Throughput is shipped/makespan * 3600, rounded to two decimals."]),
      b("avgCycleTime", round(chains.reduce((a, x) => a + x, 0) / n), null, ["Each cycle must include its service chain and minimum transit; the grader rounds the average to two decimals."]),
      b("packages", n, n, invariant), b("shipped", n, n, invariant), b("unshipped", 0, 0, invariant),
      b("missorts", 0, n, ["A package can be marked mis-sorted at most once."]),
      b("damaged", 0, packages.filter((p) => p.fragile).length, ["Only fragile packages can be damaged; each package is counted once."]),
      b("avgWait", 0, null, ["Queue waiting time cannot be negative."]), b("maxQueue", 0, n, ["No queue can contain more than all scenario packages."]),
      b("travelCells", cells.reduce((a, x) => a + x, 0), 3 * n * (task.initial.grid.w + task.initial.grid.h - 2), ["Every shipped package traverses three legs; each leg is bounded by the grid Manhattan diameter, and total travel cannot beat fixed-dock distance or station spacing."]),
      b("capex", capexMin, task.capexCap, ["Fixed docks plus the minimum legal sorter and pack counts set a capital floor; task validation enforces the capital ceiling."]),
      b("objective", round(makespan + capexMin / OBJECTIVE.capexPerSecond), null, [...proof, "All penalties are nonnegative; objective includes makespan plus minimum capex/100, rounded to two decimals."]),
    ];
  });
}

function scopedBounds(check: DoDCheck, bounds: MetricBound[]): MetricBound[] {
  const rows = bounds.filter((b) => b.metric === check.metric);
  if (check.scope === "every") return rows;
  return [{ scenarioId: "mean", metric: check.metric, lower: rows.reduce((a, b) => a + b.lower, 0) / rows.length,
    upper: rows.every((b) => b.upper !== null) ? rows.reduce((a, b) => a + b.upper!, 0) / rows.length : null,
    proof: ["Arithmetic mean of the per-scenario physical bounds.", ...rows.flatMap((b) => b.proof)] }];
}

function guaranteed(check: DoDCheck, bounds: MetricBound[]): boolean {
  return scopedBounds(check, bounds).every((b) => check.op === ">=" ? check.value <= b.lower : check.op === "<=" ? b.upper !== null && check.value >= b.upper : b.upper === b.lower && check.value === b.lower);
}

/** A redundant all-shipped encoding cannot block an otherwise meaningful deadline. */
export function dropFloorRedundancies(dod: DefinitionOfDone, bounds: MetricBound[]): DefinitionOfDone {
  return { ...dod, checks: dod.checks.filter((c) => FLOOR_CHECKS.some((f) => sameCheck(c, f)) || !["shipped", "unshipped"].includes(c.metric) || !guaranteed(c, bounds)) };
}

export function assessFeasibility(dod: DefinitionOfDone, bounds: MetricBound[]): Feasibility {
  const violations: Feasibility["violations"] = [];
  for (const check of dod.checks) {
    for (const b of scopedBounds(check, bounds)) {
      if (((check.op === "<=" || check.op === "==") && check.value < b.lower) || ((check.op === ">=" || check.op === "==") && b.upper !== null && check.value > b.upper)) {
        violations.push({ checkId: check.id, scenarioIds: b.scenarioId === "mean" ? bounds.filter((x) => x.metric === check.metric).map((x) => x.scenarioId) : [b.scenarioId],
          proof: `${check.metric} ${check.op} ${check.value} (${check.scope}) contradicts the physical interval [${b.lower}, ${b.upper ?? "unbounded"}] for ${b.scenarioId}. ${b.proof.join(" ")}` });
      }
    }
  }
  return { status: violations.length ? "infeasible" : "not-ruled-out", bounds, violations };
}

export function vacuityErrors(dod: DefinitionOfDone, bounds: MetricBound[]): string[] {
  const goalChecks = dod.checks.filter((c) => !FLOOR_CHECKS.some((f) => sameCheck(c, f)));
  if (!goalChecks.length) return ["no goal-specific constraint beyond the mandatory floor"];
  const errors = goalChecks.flatMap((check) => {
    return guaranteed(check, bounds) ? [`${check.id} is vacuous: physical invariants already guarantee ${check.metric} ${check.op} ${check.value}`] : [];
  });
  for (const check of dod.checks) {
    const applicable = dod.checks.filter((c) => c.metric === check.metric && (check.scope === "mean" || c.scope === "every"));
    const lower = Math.max(-Infinity, ...applicable.filter((c) => c.op !== "<=").map((c) => c.value));
    const upper = Math.min(Infinity, ...applicable.filter((c) => c.op !== ">=").map((c) => c.value));
    if (lower > upper) errors.push(`contradictory ${check.scope} bounds for ${check.metric}: ${lower} > ${upper}`);
  }
  return [...new Set(errors)];
}
