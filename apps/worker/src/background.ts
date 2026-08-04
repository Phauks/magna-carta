import type { Context } from "hono";

// Fire-and-forget background work that must NEVER block or fail the response. Uses
// executionCtx.waitUntil when an execution context is present (production + most test paths); falls
// back to a detached, error-swallowed promise where there is none (some test harnesses construct a
// request without one — c.executionCtx is a throwing getter there), so the handler still returns.
// Callers hand in an already-settled-on-failure promise when the failure needs reporting: this
// helper only guarantees the work leaves the response path, not that a rejection is logged.
export function runInBackground(c: Context, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void Promise.resolve(work).catch(() => {});
  }
}
