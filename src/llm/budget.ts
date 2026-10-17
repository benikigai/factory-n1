/** Per-process reservations include in-flight calls and uncertain failed requests. */
export class CallBudget {
  private attempts = 0;
  private charged = 0;
  private reservations = new Map<number, number>();

  constructor(readonly limits: { calls: number; usd: number }) {
    if (!Number.isInteger(limits.calls) || limits.calls < 0 || !Number.isFinite(limits.usd) || limits.usd < 0) {
      throw new Error("CALL_BUDGET must be a nonnegative integer and SPEND_CAP_USD a nonnegative number");
    }
  }

  snapshot() {
    return { attempts: this.attempts, chargedUsd: this.charged,
      reservedUsd: [...this.reservations.values()].reduce((a, b) => a + b, 0) };
  }

  reserve(usd: number): number {
    if (!Number.isFinite(usd) || usd < 0) throw new Error("invalid cost reservation");
    const s = this.snapshot();
    if (s.attempts >= this.limits.calls || s.chargedUsd + s.reservedUsd + usd > this.limits.usd + 1e-12) {
      throw new Error(`spend cap reached: ${s.attempts}/${this.limits.calls} attempts, $${(s.chargedUsd + s.reservedUsd).toFixed(4)} committed; next reservation $${usd.toFixed(4)}`);
    }
    const id = ++this.attempts;
    this.reservations.set(id, usd);
    return id;
  }

  settle(id: number, usd: number) {
    if (!this.reservations.has(id)) throw new Error("unknown or settled reservation");
    if (!Number.isFinite(usd) || usd < 0) throw new Error("invalid reported cost");
    this.reservations.delete(id);
    this.charged += usd;
  }

  // On transport failure or missing usage, retain the reservation: billing is unknown.
}
