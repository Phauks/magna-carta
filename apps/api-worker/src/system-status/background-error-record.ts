/*
 * Keeping the failures nobody was shown in the same record as the ones somebody was.
 *
 * A sweep, a queue consumer or a Cron pass that fails logs `operation.failed` and shows nobody an
 * Error ID. Workers Logs keeps the line, but the Recent Errors tab could only read it back with an
 * account token. This installs the telemetry package's failed-operation tap (failed-operation-tap.ts)
 * so each such line also becomes an `error_record` row, `source` background, kept and swept on the
 * same thirty days as a member's failures, and readable with no token at all.
 *
 * What the row holds is what the log line already held, after the logger scrubbed it: the operation's
 * name, the error's kind, the scrubbed message head and the Error ID. No firm and no user, because the
 * event carries neither.
 *
 * The write is never awaited by the code that failed. Each one is tracked (src/http/deferred-work.ts),
 * the scheduled and queue handlers wait for `settleBackgroundFailureRecords` before they return,
 * because a promise still running when such a handler returns may be cancelled, and a request hands
 * whatever it left pending to its execution context (src/http/telemetry-middleware.ts). A failed write is
 * swallowed WITHOUT logging: logged as `operation.failed`, it would be handed straight back here.
 */
import {
  ERROR_RECORD_WRITE_OPERATION,
  errorRecordFromFailureEvent,
  insertErrorRecordStatement,
} from "@magna-carta/data-access/error-record-statements";
import type { TelemetryEvent } from "@magna-carta/telemetry/event";
import { setFailedOperationTap } from "@magna-carta/telemetry/failed-operation-tap";
import { serviceIdentity } from "@magna-carta/telemetry/service-identity";
import type { Bindings } from "../bindings.ts";
import { trackBackgroundWork } from "../http/deferred-work.ts";

export { ERROR_RECORD_WRITE_OPERATION };

const pending = new Set<Promise<unknown>>();

/** The row a logged failure becomes, or null where the event cannot be one. */
export function backgroundFailureRow(event: TelemetryEvent, service: string) {
  return errorRecordFromFailureEvent(event, service);
}

/** Install the tap over this env's control-plane database. Idempotent; the env is stable per isolate. */
export function recordBackgroundFailures(env: Pick<Bindings, "DB_CONTROL">): void {
  setFailedOperationTap((event) => {
    const row = backgroundFailureRow(event, serviceIdentity());
    if (row === null) return;
    const write = trackBackgroundWork(
      insertErrorRecordStatement(env.DB_CONTROL, row)
        .run()
        .catch(() => {
          // Swallowed on purpose (see above): the line is in Workers Logs.
        }),
    );
    pending.add(write);
    void write.finally(() => pending.delete(write));
  });
}

/** Whether any background failure write is still running. */
export function backgroundFailureRecordsPending(): boolean {
  return pending.size > 0;
}

/** Wait for every background failure write started so far. Never rejects. */
export async function settleBackgroundFailureRecords(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled(pending);
  }
}
