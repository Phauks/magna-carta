// The one home for background-failure logging. The `operation.failed` emission was
// hand-rolled identically at every non-request error sink (cron sweep, request-path sweep, auth
// hook, cron entry point); this collapses it to one call so the error-coercion, the redaction
// message-head cap, and the error_/correlation_ minting cannot drift between sites (golden rule 1 + the
// one-logging-path of golden rule 4).
import { operationFailed } from "./events.ts";
import { newCorrelationId, newErrorId } from "./ids.ts";
import type { Logger } from "./logger.ts";
import type { ErrorId } from "@magna-carta/identifiers/types";

// error.message can carry user content; cap the logged head and let scrub.ts backstop the rest. The
// single home for this redaction parameter — request-path error.captured imports it too, so the cap
// is named once, never a magic literal per site.
export const MESSAGE_HEAD_LENGTH = 120;

// Log an operation.failed event for a caught background error, and RETURN the Error ID it minted.
// correlationId defaults to a fresh mint (a background op is its own unit of work); pass a
// pass-scoped id to group a cron pass's events.
//
// The return value is the whole point of the signature. A caller that has to show the member an
// Error ID used to mint its own and then call this, which minted a SECOND one — so the record's
// `errorId` field named a failure nobody held, and the id the member was actually quoting survived
// only if the caller had thought to bury it in the message. A support search against the field
// then found nothing, which is the one thing this field exists to make possible. Taking the id
// from here instead means there is one per failure by construction.
export function logOperationFailed(
  logger: Logger,
  operation: string,
  caught: unknown,
  correlationId: string = newCorrelationId(),
): ErrorId {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  const errorId = newErrorId();
  logger.log(
    operationFailed(
      { correlationId, now: new Date().toISOString() },
      {
        operation,
        errorName: error.name,
        messageHead: error.message.slice(0, MESSAGE_HEAD_LENGTH),
        errorId,
      },
    ),
  );
  return errorId;
}
