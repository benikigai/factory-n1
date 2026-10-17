import { randomUUID } from "node:crypto";

interface BudgetSource {
  id: string;
  revision: number;
  attempts: number;
  chargedUsd: number;
  reservations: [number, number][];
}
export interface BudgetState {
  version: 1;
  limits: { calls: number; usd: number };
  sources: BudgetSource[];
}

/** Reservations retain their process identity, so importing a checkpoint twice cannot double count it. */
export class CallBudget {
  readonly id = randomUUID();
  private attempts = 0;
  private charged = 0;
  private reservations = new Map<number, number>();
  private revision = 0;
  private imported = new Map<string, BudgetSource>();

  constructor(readonly limits: { calls: number; usd: number }) {
    if (!Number.isInteger(limits.calls) || limits.calls < 0 || !Number.isFinite(limits.usd) || limits.usd < 0) {
      throw new Error("CALL_BUDGET must be a nonnegative integer and SPEND_CAP_USD a nonnegative number");
    }
  }

  snapshot() {
    const sources = this.exportState().sources;
    return { attempts: sources.reduce((n, s) => n + s.attempts, 0), chargedUsd: sources.reduce((n, s) => n + s.chargedUsd, 0),
      reservedUsd: sources.reduce((n, s) => n + s.reservations.reduce((sum, [, usd]) => sum + usd, 0), 0) };
  }

  exportState(): BudgetState {
    return { version: 1, limits: { ...this.limits }, sources: [
      ...this.imported.values(),
      { id: this.id, revision: this.revision, attempts: this.attempts, chargedUsd: this.charged, reservations: [...this.reservations] },
    ] };
  }

  restore(state: BudgetState) {
    if (state.version !== 1 || state.limits.calls !== this.limits.calls || state.limits.usd !== this.limits.usd) throw new Error("checkpoint process spend caps differ");
    const sources = new Map(this.imported);
    const ids = new Set<string>();
    for (const source of state.sources) {
      if (!source.id || ids.has(source.id) || !Number.isInteger(source.revision) || source.revision < 0 || !Number.isInteger(source.attempts) || source.attempts < 0 || !Number.isFinite(source.chargedUsd) || source.chargedUsd < 0) throw new Error("invalid checkpoint spend state");
      ids.add(source.id);
      const reservationIds = new Set<number>();
      for (const [id, usd] of source.reservations) {
        if (!Number.isInteger(id) || id < 1 || id > source.attempts || reservationIds.has(id) || !Number.isFinite(usd) || usd < 0) throw new Error("invalid checkpoint cost reservation");
        reservationIds.add(id);
      }
      // This process already knows all of its own requests, including any since the checkpoint.
      if (source.id === this.id) continue;
      const existing = sources.get(source.id);
      if (!existing || source.revision > existing.revision) sources.set(source.id, structuredClone(source));
    }
    this.imported = sources;
  }

  reserve(usd: number): number {
    if (!Number.isFinite(usd) || usd < 0) throw new Error("invalid cost reservation");
    const s = this.snapshot();
    if (s.attempts >= this.limits.calls || s.chargedUsd + s.reservedUsd + usd > this.limits.usd + 1e-12) {
      throw new Error(`spend cap reached: ${s.attempts}/${this.limits.calls} attempts, $${(s.chargedUsd + s.reservedUsd).toFixed(4)} committed; next reservation $${usd.toFixed(4)}`);
    }
    const id = ++this.attempts;
    this.reservations.set(id, usd);
    this.revision++;
    return id;
  }

  settle(id: number, usd: number) {
    if (!this.reservations.has(id)) throw new Error("unknown or settled reservation");
    if (!Number.isFinite(usd) || usd < 0) throw new Error("invalid reported cost");
    this.reservations.delete(id);
    this.charged += usd;
    this.revision++;
  }

  // On transport failure or missing usage, retain the reservation: billing is unknown.
}
