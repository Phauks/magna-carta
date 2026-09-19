import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "./bindings.ts";
import { trackBackgroundWork } from "./background.ts";
import { runScheduledSweep } from "./scheduled.ts";

// Best-effort, request-path outbox sweep scheduled AFTER a route commits a member.provision row
// (firms.ts owner activation, members.ts invite). Provision/invite email the activation link
// immediately, but only the */5 cron sweeps the outbox — without this, a fast-activating owner or
// invitee gets `permissions: []` and 403s until the next cron fire. This shortens that window to
// the sweep's own latency.
//
// This is ONLY a latency optimization, never a correctness guarantee: the cron remains the
// at-least-once relay, and sweeps may safely OVERLAP (scheduled.ts's documented invariant — every
// status transition is guarded and every consumer dedups). Runs off the response path through
// executionCtx.waitUntil; any failure is swallowed and logged through the telemetry pipeline
// (operation.failed) so a sweep hiccup never disturbs the already-committed 201.
// Narrowed to the one method used: hono's `c.executionCtx` is structurally narrower than the ambient
// Workers `ExecutionContext` (which carries runtime-only fields like `tracing`), so taking the full
// type would reject the call site. Depending only on `waitUntil` keeps this stable as the Workers
// type surface grows.
//
// The sweep is also registered with `trackBackgroundWork` (background.ts) — a whole cron pass on the
// tail of a request is the longest-running piece of background work this worker starts, and the test
// harness has to be able to wait for it before the environment goes away underneath it.
export function scheduleRequestPathSweep(
  executionContext: Pick<ExecutionContext, "waitUntil">,
  env: Bindings,
): void {
  executionContext.waitUntil(
    trackBackgroundWork(
      runScheduledSweep(env).catch((caught: unknown) => {
        logOperationFailed(createWorkersLogger(env.TELEMETRY), "request-path-sweep", caught);
      }),
    ),
  );
}
