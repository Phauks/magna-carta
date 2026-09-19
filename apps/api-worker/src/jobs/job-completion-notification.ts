import { recordJobCompletionNotification } from "@magna-carta/notifications/job-completion";
import type { UserId } from "@magna-carta/identifiers/types";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";

// THE ONE PLACE A JOB COORDINATOR WRITES A NOTIFICATION, so adding the next coordinator is a call
// rather than a copy of the error handling.
//
// A coordinator's state lives in Durable Object storage, not in the firm's database, so unlike every
// other emission point in the platform there is no atomic batch to attach a durable row to. That
// makes this write its own, and best-effort by construction — which decides how it fails:
//
//   THE JOB'S OUTCOME IS THE THING THAT MATTERS, and the notification is a convenience beside it.
//   A member whose document was filed must never be told it failed because the row announcing it
//   could not be written, and a coordinator must never be left in a non-terminal state because a
//   notification threw. So every failure here is caught, counted, and logged, and the caller's
//   transition proceeds regardless. The socket push is unaffected either way.
//
// Nothing identifying reaches the log: the operation name carries the firm, which every other cron
// and consumer failure already carries, and the payload never appears.
export async function notifyJobCompletion(
  env: Bindings,
  input: {
    readonly firmId: string;
    readonly emissionPoint: string;
    readonly subjectId: string;
    readonly matterId: string | null;
    readonly requestedByUserId: string | null;
    readonly terminalOutcome: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  // Nobody asked, so there is no reply to send. The ordinary case for a system-triggered job, and
  // cheaper to answer here than to resolve a firm database and find out.
  if (input.requestedByUserId === null || input.requestedByUserId.length === 0) return;
  try {
    const result = await recordJobCompletionNotification({
      database: firmDatabaseFor(env.FIRM_DATABASE, input.firmId),
      emissionPoint: input.emissionPoint,
      subjectId: input.subjectId,
      matterId: input.matterId,
      requestedByUserId: input.requestedByUserId as UserId,
      terminalOutcome: input.terminalOutcome,
      payload: input.payload,
      now: new Date().toISOString(),
    });
    // The requester silenced the jobs category. Counted rather than passed over: "the thing you
    // asked for is ready" failing to arrive is the likeliest thing a member reports as broken, and
    // the counter beside the firm's own tally is what lets somebody answer it without guessing.
    for (const suppression of result.suppressedInApp) {
      createWorkersLogger(env.TELEMETRY).count(
        "notifications.suppressed_by_preference",
        { category: suppression.category, reason: suppression.reason },
        suppression.count,
      );
    }
  } catch (caught) {
    logOperationFailed(
      createWorkersLogger(env.TELEMETRY),
      `job-completion-notification:${input.firmId}`,
      caught,
      newCorrelationId(),
    );
  }
}
