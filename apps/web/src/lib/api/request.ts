/*
 * The app's transport seam: one same-origin `fetch` against a relative `/api/v1` path, and the three
 * outcomes a caller has to render.
 *
 * This is the ONE home for reading a problem document. It used to be four: this module, the joining
 * screens, the WHOIS tool and the safe-browse tool each kept a private copy, and the copies had
 * begun to disagree about which fields matter — the joining one grew `attemptsRemaining` precisely
 * because this one dropped it. The shapes themselves live in ./problem.ts; this module owns the
 * envelope, and the response bodies stay with the surface that reads them (apps/web does not depend
 * on @magna-carta/api-client, so each surface hand-writes what it reads, mirroring
 * apps/api-worker/openapi/openapi.json).
 *
 * Every call resolves rather than throws. A caller has three outcomes to render — the value, a
 * server that answered with a problem document, and nothing answering at all — and collapsing the
 * last two into one `catch` loses the only distinction that changes what a person should do about it.
 */
import { readProblem, requestLine, type Failure, type Problem } from "./problem.ts";

export type { Failure, Problem, ProblemFieldError } from "./problem.ts";
export { requestLine } from "./problem.ts";

/**
 * One page of a cursor-paged listing. `nextCursor` is a string when the record continues past this
 * page and null when it does not — never absent, so "there is no more" and "nobody said" cannot be
 * confused. The value is opaque: pass it back, never parse it.
 */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * The three outcomes.
 *
 * Both failing branches carry a `failure` — the record every failure surface renders from. On the
 * `problem` branch `failure.problem` IS `problem`; the field is repeated rather than reached through
 * so that the ~50 call sites reading `outcome.problem.detail` keep working unchanged while anything
 * rendering a failure can hand `outcome.failure` straight to the component without reassembling the
 * request line and the timestamp by hand at each site. Repeating a reference costs nothing; making
 * every caller rebuild the same two facts is what produced the drift this file exists to end.
 */
export type ApiOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "problem"; problem: Problem; failure: Failure }
  | { kind: "transport"; failure: Failure };

/**
 * A refusal outcome for a caller that already holds the problem — a failure line read off a stream,
 * a storage write that never went through `requestJson`, a test. Exists so those callers do not
 * hand-assemble the failure record and quietly leave a field out of it, which is how the request
 * line and the timestamp went missing from most surfaces in the first place.
 */
export function problemOutcome<T>(
  problem: Problem,
  request: string,
  failedAt: Date = new Date(),
): ApiOutcome<T> {
  return { kind: "problem", problem, failure: { problem, request, failedAt } };
}

/** The matching "nothing answered" outcome. */
export function transportOutcome<T>(request: string, failedAt: Date = new Date()): ApiOutcome<T> {
  return { kind: "transport", failure: { problem: null, request, failedAt } };
}

interface JsonRequest {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  /**
   * The idempotency key for a write the contract requires one on. A retried submit must not file a
   * second document, and the server rejects the call outright when the header is absent.
   */
  readonly idempotencyKey?: string;
}

/** The one place a `/api/v1` call is made. Never throws; a dead transport is its own outcome. */
export async function requestJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  request: JsonRequest = {},
): Promise<ApiOutcome<T>> {
  const method = request.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.idempotencyKey !== undefined) headers["idempotency-key"] = request.idempotencyKey;

  const line = requestLine(method, path);

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    return { kind: "transport", failure: { problem: null, request: line, failedAt: new Date() } };
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    return { kind: "problem", problem, failure: { problem, request: line, failedAt: new Date() } };
  }

  try {
    return { kind: "ok", value: (await response.json()) as T };
  } catch {
    // The server answered successfully and the body will not parse. Nothing described a failure, so
    // this is the "nothing answered" case rather than a refusal, and it says so.
    return { kind: "transport", failure: { problem: null, request: line, failedAt: new Date() } };
  }
}
