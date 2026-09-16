// The editor worker's error boundary — the standard reporting path, applied to the one surface that
// had none.
//
// This worker fronts every request the browser makes to a document's container: the editor page, its
// assets, and the WebSocket the document itself rides. Until this module, a throw anywhere on that
// path reached the runtime unhandled: the browser saw a bare error page, no Error ID was minted, no
// structured event was written, and the only trace was a raw exception line in Workers Logs that
// nothing correlated. A refused WebSocket was worse than that — it was silent. The browser's
// WebSocket API reports every failed handshake as "closed before the connection is established",
// whatever the server actually answered, so a container that answered 502 to the upgrade and a
// worker that threw while proxying it were indistinguishable from the outside. One such defect
// shipped and took a round trip of guesswork to name; this module is what would have named it in one
// log line.
//
// Two events, from the shared catalog, chosen for what each carries: a thrown exception is
// `error.captured`, the request-path event, with the route and the method; a refused upgrade is
// `operation.failed`, because nothing threw — the container answered, just not with a socket — and
// the container's actual status is the fact worth keeping.
//
// THE ONE VALUE THIS SURFACE MUST NEVER LOG IS IN EVERY URL. The editor carries its WOPI access
// token as a query parameter on every request the browser makes here — `?access_token=…` on the page,
// the assets and the socket alike — so a log line that quoted a URL would quote a bearer token with
// it. The route is therefore always the PATHNAME, never the URL, and never the query; the event
// builders have no slot for anything else, and the scrubbing backstop in @magna-carta/telemetry
// recognises the token's own shape should an error message ever quote one. Reasoning home:
// docs/conventions/error-logging.md.

import { errorCaptured, operationFailed } from "@magna-carta/telemetry/events";
import { newCorrelationId, newErrorId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";

// How much of an error's message a log line keeps. Enough to name the fault; the scrubber backstops
// the rest, since a message can quote whatever the code that threw it chose to include.
const MESSAGE_HEAD_LENGTH = 200;

export interface EditorDiagnosticsDeps {
  readonly logger: Logger;
  // Injected rather than read from a clock, so the boundary is deterministic under test.
  readonly now: () => string;
}

/** The request's route as a loggable SHAPE: the pathname alone. The query carries the token. */
export function routeOf(request: Request): string {
  return new URL(request.url).pathname;
}

/** Whether the browser asked for a WebSocket — the request that carries the document itself. */
export function isUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/**
 * Runs one proxied request under the surface's diagnostics. A thrown fault becomes a 500 carrying
 * an Error ID in `X-MC-Error-Id` and one redacted `error.captured`; an upgrade the container did not
 * accept is passed through as answered and recorded as one `operation.failed` naming the status —
 * the only record of that status anywhere, since the browser cannot see it.
 */
export async function withEditorDiagnostics(
  request: Request,
  deps: EditorDiagnosticsDeps,
  fn: () => Promise<Response>,
): Promise<Response> {
  // Minted here rather than threaded from a middleware: this worker has no request pipeline, and a
  // correlation id exists so that everything about one request joins on one value.
  const correlationId = newCorrelationId();
  try {
    const response = await fn();
    // A socket the container accepted arrives as a 101 carrying `webSocket`; anything else on an
    // upgrade request is the container declining, and its status is the diagnosis. `== null` rather
    // than `=== null`: the runtime leaves the property null on an ordinary response, and a standards
    // Response has no such property at all.
    if (isUpgrade(request) && response.status !== 101 && response.webSocket == null) {
      deps.logger.log(
        operationFailed(
          { correlationId, now: deps.now() },
          {
            operation: "editor.upgrade",
            errorName: "UpgradeRefused",
            messageHead: `container answered ${String(response.status)} on ${routeOf(request)}`,
            errorId: newErrorId(),
          },
        ),
      );
    }
    return response;
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const errorId = newErrorId();
    deps.logger.log(
      errorCaptured(
        { correlationId, now: deps.now() },
        {
          errorId,
          route: routeOf(request),
          method: request.method,
          errorName: error.name,
          messageHead: error.message.slice(0, MESSAGE_HEAD_LENGTH),
        },
      ),
    );
    // A bare 500 with the Error ID and nothing else. The editor's failures never render a page — the
    // browser is loading a frame or opening a socket — so a body would be read by nobody, and the ID
    // is what a support trace joins on.
    return new Response(null, { status: 500, headers: { "X-MC-Error-Id": errorId } });
  }
}
