/*
 * The generated client, configured for this app — the ONE place `apps/web` reaches the server.
 *
 * WHY THE GENERATED CLIENT AND NOT A HAND-WRITTEN ONE. The contract publishes 615 operations across
 * 493 paths, and @magna-carta/api-client generates a typed function and a query-options factory for
 * every one of them from the committed snapshot, with CI regenerating and diff-failing on drift.
 * Hand-written modules mirroring the same contract cannot be kept honest by anything: they drift
 * silently and the drift is only found by a member hitting it. `requestJson` in ./request.ts is the
 * outgoing seam and is deleted when the last screen is off it.
 *
 * WHAT THIS MODULE ADDS ON TOP. The generated factories set `throwOnError: true`, so a failing call
 * throws the PARSED problem document — which loses the status, loses the request line, and collapses
 * "the server refused" into the same `catch` as "nothing answered". That distinction is the one that
 * changes what a person should do about it, and every failure surface in the app is built on it
 * (./problem.ts). So an error interceptor reassembles the `Failure` record before the exception
 * leaves the transport, and a response interceptor reports it. Two consequences worth knowing:
 *
 *   - Everything thrown out of this client is an `ApiCallFailed`, carrying the same `Failure` the
 *     hand-written seam produced. `failureOf()` reads it back; nothing above here parses an error.
 *   - Reporting is structural rather than remembered. Every failure passes through one interceptor,
 *     so no surface has to report its own and one that forgot would be invisible — which is what
 *     golden rule 4 asks for and what made `requestJson`'s own `failed()` helper worth having.
 */
import { client } from "@magna-carta/api-client/client";
import { problemOf, requestLine, type Failure } from "./problem.ts";
import type { ApiOutcome } from "./request.ts";
import { platformHealth } from "$lib/diagnostics/platform-health.svelte.ts";

/**
 * What every failing call throws. One type, so a caller never branches on what the transport felt
 * like throwing — the interesting distinction is inside `failure.problem`, which is null when
 * nothing answered and populated when the server described a refusal.
 */
export class ApiCallFailed extends Error {
  readonly failure: Failure;

  constructor(failure: Failure) {
    // The sentence is the server's where there is one: an Error surfacing in a console or a test
    // should say what the server said, not "request failed".
    super(failure.problem?.detail ?? failure.problem?.title ?? `No answer to ${failure.request}`);
    this.name = "ApiCallFailed";
    this.failure = failure;
  }
}

/**
 * The failure behind a thrown value, for a surface holding an error it did not catch itself — a
 * query's `error`, a mutation's `error`. Anything that is not an `ApiCallFailed` gets a transport
 * failure rather than nothing: a surface must always have a record to render, and an error that
 * reached here by another route is still an error the member is looking at.
 */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiCallFailed) return error.failure;
  return { problem: null, request: "", failedAt: new Date() };
}

/**
 * A generated call's result as the three-outcome `ApiOutcome` the screens render from.
 *
 * THE BRIDGE BETWEEN THE TWO SEAMS, and it lives here rather than in each migrating module because
 * there is exactly one correct way to write it and two copies of it would be two chances to collapse
 * the branch that matters. The generated factories throw on failure; a screen needs the refusal and
 * the silence told apart, because they are different things for a member to do something about. A
 * module moving off `requestJson` wraps its call in a try and hands the caught value here, and its
 * own exported shape does not change — which is what lets a screen migrate without being rewritten.
 */
export function outcomeOf<T>(error: unknown): ApiOutcome<T> {
  const failure = failureOf(error);
  return failure.problem === null
    ? { kind: "transport", failure }
    : { kind: "problem", problem: failure.problem, failure };
}

/** True when the call failed because the member is not signed in. The session guard reads this. */
export function isUnauthenticated(error: unknown): boolean {
  return failureOf(error).problem?.status === 401;
}

/**
 * Point the generated client at this origin and install the two interceptors.
 *
 * CALLED WHEN THIS MODULE IS EVALUATED, not from a load function. Configuration has to be in place
 * before the first request, and a load function cannot promise that: SvelteKit runs a parent and a
 * child load CONCURRENTLY unless the child awaits `parent()`, so a root load calling this would not
 * reliably beat the (app) session guard's own read. Module evaluation does promise it — anything
 * that can make a request imports the generated client, and an import is evaluated before the code
 * that imported it runs. It is idempotent so a test can re-run it.
 *
 * THE BASE URL IS EMPTY ON PURPOSE. The generated operations carry absolute paths already
 * (`/api/v1/me`), and the snapshot's `servers` entry is the public API origin — composing the two
 * would produce `https://.../v1/api/v1/me`. The app is served from the same origin as its API, so
 * the path IS the URL, which is also what keeps the session cookie same-site.
 *
 * THAT MAKES THE REQUEST RELATIVE, AND A NODE TEST HAS NOTHING TO RESOLVE IT AGAINST. A browser
 * resolves `/api/v1/me` against the document's origin; `new Request("/api/v1/me")` under Node throws
 * while BUILDING the request, before any fetch runs — which surfaces as a transport failure carrying
 * an empty request line, not as an obviously wrong URL. A test driving this client must set an
 * absolute `baseUrl` of its own (test/joining-routing.test.ts is the worked example). The app is
 * unaffected: it only ever runs in a browser.
 */
export function configureApiClient(): void {
  client.setConfig({ baseUrl: "" });
  client.interceptors.error.clear();
  client.interceptors.response.clear();

  client.interceptors.error.use(
    (error: unknown, response: Response | undefined, request: Request | undefined) =>
      failed(error, response, request),
  );

  client.interceptors.response.use((response: Response) => {
    // A read that worked is evidence too: it clears a platform notice rather than leaving one up
    // until it ages out, so recovery is visible as soon as it happens. `ok` is checked because the
    // response interceptor runs before the client decides the call failed.
    if (response.ok) platformHealth.noteSuccess();
    return response;
  });
}

configureApiClient();

function failed(
  error: unknown,
  response: Response | undefined,
  request: Request | undefined,
): ApiCallFailed {
  // `request` is absent only when building the request itself failed, which no path in this app can
  // reach — the operations are generated. An empty line still renders: a failure surface showing no
  // request line is worse than one showing nothing to report, and neither is worth a fourth outcome.
  const line =
    request === undefined ? "" : requestLine(request.method, new URL(request.url).pathname);

  // No response means nothing answered — a dead link, a Worker that is not there, an aborted call.
  // A response that is present but whose body did not describe a problem still yields a usable
  // problem carrying the status, because a failure must never fail to be describable.
  const failure: Failure =
    response === undefined
      ? { problem: null, request: line, failedAt: new Date() }
      : { problem: problemOf(error, response.status), request: line, failedAt: new Date() };

  platformHealth.note(failure);
  return new ApiCallFailed(failure);
}
