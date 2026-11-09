// Telemetry wiring, in two halves that share the request-scoped context the first stashes:
//   • telemetryMiddleware — installed FIRST in app.ts. Mints the correlation id (correlation_), stashes it
//     + a request-scoped Logger so every downstream guard/handler/problemJson reads them, times the
//     request, and on NORMAL completion logs request.completed (route TEMPLATE, never the concrete
//     path — it can embed matter numbers). It does NOT try/catch the chain: Hono's compose catches a thrown handler
//     at the throwing layer and routes it to app.onError, so an upstream try/catch would only ever
//     see the already-handled response. The error path is therefore the onError handler below.
//   • telemetryErrorHandler — registered with app.onError. The real error boundary: mints an error_
//     Error ID, logs error.captured (message head, which the Workers logger scrubs), and returns the
//     RFC 9457 500 carrying that same Error ID. The middleware then skips request.completed (c.error
//     is set), so a failed request emits error.captured as its single terminal event.
import type { Context, MiddlewareHandler } from "hono";
import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import { errorCaptured, requestCompleted } from "@magna-carta/telemetry/events";
import { newCorrelationId, newErrorId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { MESSAGE_HEAD_LENGTH } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../bindings.ts";
import type { AppVariables } from "./chokepoint/ports.ts";
import { problemJson } from "./contracts/problem.ts";
import { FirmBucketUnavailableError } from "../files/firm-bucket-fault.ts";

type TelemetryEnv = { Bindings: Bindings; Variables: AppVariables };

export function telemetryMiddleware(
  loggerForEnv: (env: Bindings) => Logger,
  // One injected epoch-ms clock: duration is the delta. Defaults to Date.now (valid in the Workers
  // runtime); tests inject a counter.
  clock: () => number = () => Date.now(),
): MiddlewareHandler<TelemetryEnv> {
  return async (c, next) => {
    const correlationId = newCorrelationId();
    c.set("correlationId", correlationId);
    c.set("logger", loggerForEnv(c.env));

    const startMs = clock();
    await next();

    // An exception was caught by Hono's compose and handled by telemetryErrorHandler (which logged
    // error.captured and produced the 500) — c.error is set. Do not also log request.completed: a
    // failed request has exactly one terminal event.
    if (c.error !== undefined) return;

    const endMs = clock();
    c.get("logger")?.log(
      requestCompleted(
        { correlationId, now: new Date(endMs).toISOString() },
        {
          route: c.req.routePath,
          method: c.req.method,
          status: c.res.status,
          durationMs: endMs - startMs,
        },
      ),
    );
  };
}

// The app.onError handler — the outermost error boundary. Reads the correlation id + logger the
// middleware stashed (falling back to a fresh correlation id only if onError somehow fires before
// the middleware ran, which it cannot today).
export function telemetryErrorHandler(
  clock: () => number = () => Date.now(),
): (error: Error, c: Context<TelemetryEnv>) => Response {
  return (caught, c) => {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const correlationId = c.get("correlationId") ?? newCorrelationId();
    const errorId = newErrorId();
    c.get("logger")?.log(
      errorCaptured(
        { correlationId, now: new Date(clock()).toISOString() },
        {
          errorId,
          route: c.req.routePath,
          method: c.req.method,
          errorName: error.name,
          messageHead: error.message.slice(0, MESSAGE_HEAD_LENGTH),
        },
      ),
    );
    // A KNOWN deployment fault is not an unexpected one. The firm's object storage being
    // unprovisioned or unbound is a configuration state with a named remedy, so it answers as a
    // retryable 503 saying what is misconfigured — still counted and still carrying an Error ID for
    // the operator to correlate, but never leaving a member who tried to file a document with an
    // Error ID and the impression that their file was the problem.
    // A guarded write matched no row: the thing the request named moved between its precondition read
    // and its commit, and the batch rolled back whole. That is a conflict, not a fault — the member can
    // reload and decide again — so it answers 409 here rather than reaching the 500 below with an Error
    // ID for something the platform understands perfectly well. Mapped centrally because every guarded
    // write in every route means the same thing by it; a route with a richer answer (the fee and cost
    // ledgers reuse their own frozen-entry refusal) catches it first and never reaches here.
    if (error instanceof GuardedWriteRefusedError) {
      return problemJson(c, {
        type: "conflict",
        status: 409,
        title: "Something changed while this request was in flight",
        detail:
          "the record this request named changed before the change could be applied, so nothing was written — reload and try again",
        errorId,
      });
    }
    if (error instanceof FirmBucketUnavailableError) {
      return problemJson(c, {
        type: "storage-unavailable",
        status: 503,
        title: "File storage unavailable",
        detail: error.detail,
        errorId,
      });
    }
    return problemJson(c, {
      type: "internal",
      status: 500,
      title: "Internal server error",
      detail: "An unexpected error occurred. Quote the Error ID when reporting it.",
      errorId,
    });
  };
}
