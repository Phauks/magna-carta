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

export type RendererFaultKind = "transient" | "page" | "configuration";

/*
 * Classification is on the HTTP status, not the error code: the status is the axis the service
 * documents, and its codes are not enumerated anywhere that can be pinned.
 *
 * `transient` — the service was momentarily unable to serve the render: rate-limited, restarting,
 * timed out on its own side. Asking again may work.
 *
 * `page` — a 422, which the service documents as being unable to complete the action "because of
 * an issue with the site": the page crashed, ate too much memory, or took longer to load than the
 * wait allowed. Nothing about our account or our call is wrong, and nothing about the member's
 * input is either. This is the common outcome on exactly the pages this tool exists to look at, so
 * it gets its own answer rather than borrowing one of the others.
 *
 * `configuration` — anything else: an entitlement that is not enabled, a credential without the
 * permission, a parameter the action rejects. Waiting cannot fix it and the member cannot act on
 * it, so it has to reach someone who can change the account or the call.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const PAGE_FAILURE_STATUS = 422;

export class RendererFailure extends Error {
  readonly httpStatus: number;
  readonly code: number | null;
  readonly kind: RendererFaultKind;

  constructor(httpStatus: number, code: number | null) {
    // Synthesized from the two safe fields, never from the upstream text. Neutral about whose
    // fault it is, because `kind` answers that and the three answers are not the same.
    super(
      `the rendering service did not complete the capture (http=${httpStatus}, code=${code ?? "none"})`,
    );
    this.name = "RendererFailure";
    this.httpStatus = httpStatus;
    this.code = code;
    // A 2xx carrying `success: false` is the service reporting on the render rather than refusing
    // us, so it reads as a page failure on the same terms as the 422 that usually carries it.
    this.kind = TRANSIENT_STATUSES.has(httpStatus)
      ? "transient"
      : httpStatus === PAGE_FAILURE_STATUS || (httpStatus >= 200 && httpStatus < 300)
        ? "page"
        : "configuration";
  }
}
