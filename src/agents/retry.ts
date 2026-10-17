/**
 * One delayed retry for Crusoe 429s. A 429 is rejected before inference, so retrying
 * cannot double-bill; other errors are not retried (billing may be ambiguous).
 */
export async function retryOn429<T>(fn: () => Promise<T>, waitMs = 10_000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { status?: number })?.status !== 429) throw e;
    await new Promise((r) => setTimeout(r, waitMs + Math.random() * 2_000));
    return fn();
  }
}
