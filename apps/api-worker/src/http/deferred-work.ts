import type { Context } from "hono";

// Background work is work that deliberately OUTLIVES the response that started it, and that is
// exactly what makes it invisible to anything holding the request: a caller that reads the 201 has
// no handle on the sweep still running behind it. In production the runtime keeps it alive; under a
// test harness there is nothing that knows to wait, so the environment is torn down underneath work
// that is mid-flight — and background work talks to the host (it resolves modules on first use and
// it emits structured log lines), so a teardown mid-flight rejects those calls into a promise nobody
// is holding. The counters below are the missing handle: they cost two integers and one wrapper per
// piece of background work, and they let a caller that DOES need to wait — the worker test harness,
// through test/support/settle-background-work.ts — know when the worker has gone quiet.
let startedCount = 0;
let settledCount = 0;

export interface BackgroundWorkStatus {
  // Every piece of background work this isolate has ever started — monotonic, so a caller can prove
  // work was started rather than only that none is running right now.
  readonly started: number;
  // Started but not yet settled.
  readonly inFlight: number;
}

export function backgroundWorkStatus(): BackgroundWorkStatus {
  return { started: startedCount, inFlight: startedCount - settledCount };
}

// Account for one piece of background work and hand back the promise to hold onto. Every
// fire-and-forget path in this worker goes through here (directly, or through runInBackground), so
// the counters above describe all of it and not a subset — a subset would let the harness call the
// worker quiet while something it never saw was still running.
export function trackBackgroundWork(work: Promise<unknown>): Promise<unknown> {
  startedCount++;
  return Promise.resolve(work).finally(() => {
    settledCount++;
  });
}

// Fire-and-forget background work that must NEVER block or fail the response. Uses
// executionCtx.waitUntil when an execution context is present (production + most test paths); falls
// back to a detached, error-swallowed promise where there is none (some test harnesses construct a
// request without one — c.executionCtx is a throwing getter there), so the handler still returns.
// Callers hand in an already-settled-on-failure promise when the failure needs reporting: this
// helper only guarantees the work leaves the response path, not that a rejection is logged.
export function runInBackground(c: Context, work: Promise<unknown>): void {
  const tracked = trackBackgroundWork(work);
  try {
    c.executionCtx.waitUntil(tracked);
  } catch {
    void tracked.catch(() => {});
  }
}
