/**
 * One delayed retry for transient provider failures: HTTP 429 (rejected before inference) and
 * connection errors with no HTTP status (e.g. a dropped socket). The retry is a new attempt: it is
 * charged against the run's call cap and its spend reservation is held at the request-size bound,
 * so a retry never creates unaccounted spend. Other errors are not retried.
 */
export function isTransient(e: unknown): boolean {
  const err = e as { status?: number; name?: string; message?: string };
  if (err?.status === 429) return true;
  if (err?.status === undefined && /APIConnection(Timeout)?Error/.test(err?.name ?? "")) return true;
  return err?.status === undefined && /connection error|ECONNRESET|socket hang up|fetch failed/i.test(err?.message ?? "");
}

export async function retryTransient<T>(fn: () => Promise<T>, waitMs = 10_000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransient(e)) throw e;
    await new Promise((r) => setTimeout(r, waitMs + Math.random() * 2_000));
    return fn();
  }
}

/** @deprecated kept for existing call sites; same behavior as retryTransient. */
export const retryOn429 = retryTransient;
