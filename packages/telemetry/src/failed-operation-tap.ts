// A second destination for the two failure events: `operation.failed`, which a failure nobody was
// shown is logged as (a sweep, a queue consumer, a Cron pass, a step behind a response), and
// `error.captured`, an exception a Worker without a request pipeline caught at its own boundary and
// answered with an Error ID (the editor worker's `diagnostics.ts`). Workers Logs keeps every such
// line, but reading them back needs an account token a deployment may not hold, so a Worker that
// keeps its own record of failures installs a tap here and the Workers logger hands it each one.
//
// Module state, for the reason service-identity.ts gives: an isolate serves one Worker, and the
// alternative is threading a database handle through some sixty call sites that have no other reason
// to hold one. The tap is handed the event AFTER it was scrubbed and emitted, so it can only ever
// see what the log line already says, and it must not throw or log: a tap that logged its own
// failure as `operation.failed` would be handed that event too.
import type { TelemetryEvent } from "./event.ts";

export type FailedOperationTap = (event: TelemetryEvent) => void;

let installed: FailedOperationTap | null = null;

/** Install (or, with null, remove) the tap the Workers logger hands each failure event to. */
export function setFailedOperationTap(tap: FailedOperationTap | null): void {
  installed = tap;
}

/** The installed tap, or null. */
export function failedOperationTap(): FailedOperationTap | null {
  return installed;
}

/** The failure event a caught step logs. */
export const FAILED_OPERATION_EVENT = "operation.failed";

/** The failure event an exception caught at a Worker's own boundary logs. */
export const CAPTURED_ERROR_EVENT = "error.captured";

/** Whether an event is one a tap is handed. */
export function isFailureEvent(name: string): boolean {
  return name === FAILED_OPERATION_EVENT || name === CAPTURED_ERROR_EVENT;
}
