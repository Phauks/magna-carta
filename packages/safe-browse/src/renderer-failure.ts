/*
 * A refusal from the remote rendering service, carrying only the two facts that are safe to
 * record: the HTTP status the service answered with, and the error code it named.
 *
 * The upstream message is deliberately NOT carried. It can quote the suspect URL back, and a
 * failure object that cannot hold the target cannot leak it however a caller later decides to
 * log it. That is what makes `message` below safe to record anywhere — including through the
 * global error pipeline, which keeps a slice of it — and recording it is the point: the transient
 * path previously answered the member and wrote nothing to telemetry, so the one failure most
 * worth diagnosing was the only one that left no trace.
 *
 * Why a class rather than a message the caller pattern-matches: the renderer used to signal
 * capacity by throwing a string containing the words "capacity" and "limit", which the route then
 * matched with `includes`. Every structured refusal the service can make — an entitlement that is
 * not enabled, a permission the credential lacks, a rejected parameter — arrived as that one
 * sentence and was reported to the member as "at capacity, try again shortly". The distinction
 * has to survive the throw, so it travels as a field.
 */

export type RendererFaultKind = "transient" | "permanent";

/*
 * Classification is on the HTTP status, not the error code: the status is the axis the service
 * documents, and its codes are not enumerated anywhere that can be pinned. These are the statuses
 * meaning "ask again later" — the service is rate-limiting, restarting, or timed out. Every other
 * status describes our request rather than the service's capacity, and no amount of waiting fixes
 * it, so it has to reach someone who can change the account or the call.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export class RendererFailure extends Error {
  readonly httpStatus: number;
  readonly code: number | null;
  readonly kind: RendererFaultKind;

  constructor(httpStatus: number, code: number | null) {
    // Synthesized from the two safe fields, never from the upstream text.
    super(`the rendering service refused the capture (http=${httpStatus}, code=${code ?? "none"})`);
    this.name = "RendererFailure";
    this.httpStatus = httpStatus;
    this.code = code;
    // A 2xx carrying `success: false` is the service reporting that the RENDER failed rather than
    // that it refused us, and it lands here as `permanent` — which surfaces an Error ID rather
    // than a "try again". That is the loud outcome on purpose while the real codes are unknown:
    // nothing in this tool has ever observed a live refusal, so the first ones should be
    // conspicuous and logged. If page-render failures turn out to be common on hostile targets,
    // they deserve a state of their own rather than either of the two here.
    this.kind = TRANSIENT_STATUSES.has(httpStatus) ? "transient" : "permanent";
  }
}
