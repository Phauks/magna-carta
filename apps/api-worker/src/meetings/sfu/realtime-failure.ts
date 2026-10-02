import { newCorrelationId, newErrorId } from "@magna-carta/telemetry/ids";
import { operationFailed } from "@magna-carta/telemetry/events";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../../bindings.ts";

// Recording a failure of Cloudflare Realtime — the media routing service and the relay-credential
// service — through the one standard pipeline, and handing back the Error ID the member is shown.
//
// WHY THIS IS NOT `logOperationFailed`. That helper mints the Error ID inside itself and returns
// nothing, which is right for a background pass nobody is waiting on. Here somebody IS waiting: the
// refusal frame and the join response carry the handle, and a handle the server did not keep is a
// handle support cannot look up. So the id is minted here and both the event and the caller get the
// same one.
//
// WHAT NEVER REACHES THE EVENT. The `operation.failed` allowlist has four fields and none of them is
// a body, a URL or a header, so the upstream text — which can echo the application id the whole
// fleet's meetings run on, and which a session description would otherwise ride in on — has no slot
// to be logged in. The message head is capped by the same event builder every other sink uses.
const MESSAGE_HEAD_LENGTH = 120;

/**
 * Records one failure and returns its Error ID.
 *
 * The logger is optional because every guard on this path treats it as optional: a missing logger
 * loses the signal, it never costs the request. The caller still gets an Error ID, so what the member
 * is shown does not change shape depending on whether telemetry was wired.
 */
export function recordRealtimeFailure(
  logger: Logger | undefined,
  operation: string,
  caught: unknown,
  correlationId: string = newCorrelationId(),
): string {
  const errorId = newErrorId();
  const error = caught instanceof Error ? caught : new Error(String(caught));
  logger?.log(
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

/**
 * The logger for a Durable Object, which has no request and therefore no middleware-stashed one.
 *
 * Built per call rather than held on the instance: class properties do not survive hibernation, and
 * a logger over an Analytics Engine binding costs nothing to construct. A deployment without the
 * binding degrades silently inside the adapter, which is why nothing here has to test for it.
 */
export function realtimeLoggerFor(env: Bindings): Logger {
  return createWorkersLogger(env.TELEMETRY);
}
