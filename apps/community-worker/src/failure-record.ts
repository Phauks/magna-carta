// Keeping the board's failures in the platform's error record.
//
// The board answers a failure with an Error ID (board-application.ts) and logs it through the Workers
// logger. It shares the app's control-plane database, so each failure the logger emits is also written
// to the same `error_record` table the app's System Status reads, through the telemetry package's
// failed-operation tap. An Error ID a member quotes from the board can then be looked up without
// reading Workers Logs.
//
// The event written is the one already scrubbed and logged, built into a row the same way the app's
// own tap builds one (`errorRecordFromFailureEvent`), filed as `server` because the board runs no
// background work: every failure it logs is one it answered a member with. The write rides `waitUntil`, never the
// response, and a failed write is swallowed without logging: logged, it would be handed straight back.
import {
  errorRecordFromFailureEvent,
  insertErrorRecordStatement,
} from "@magna-carta/data-access/error-record-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { setFailedOperationTap } from "@magna-carta/telemetry/failed-operation-tap";
import { serviceIdentity } from "@magna-carta/telemetry/service-identity";

/**
 * Record each failure logged from here on in `database`, kept alive by `waitUntil`. Installed per
 * request because `waitUntil` belongs to one request.
 */
export function recordFailuresIn(
  database: SqlDatabase,
  waitUntil: (work: Promise<unknown>) => void,
): void {
  setFailedOperationTap((event) => {
    const row = errorRecordFromFailureEvent(event, serviceIdentity());
    if (row === null) return;
    waitUntil(
      // The board runs no background work: every failure it logs is one it answered a member with.
      insertErrorRecordStatement(database, { ...row, source: "server", status: 500 })
        .run()
        .catch(() => {
          // Nothing to do: the line is in Workers Logs.
        }),
    );
  });
}
