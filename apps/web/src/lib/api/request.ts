/*
 * The app's transport seam: one same-origin `fetch` against a relative `/api/v1` path, and the
 * three outcomes a caller has to render. Lifted out of the Documents surface when a second surface
 * needed it — a per-surface copy would be a per-surface place for the problem-document handling to
 * drift.
 *
 * `apps/web` does not depend on @magna-carta/api-client, so each surface hand-writes the response
 * shapes it reads, mirroring apps/worker/openapi/openapi.json. This module owns the envelope only;
 * the shapes stay with the surface that reads them.
 *
 * Every call resolves rather than throws. A caller has three outcomes to render — the value, a
 * server that answered with a problem document, and nothing answering at all — and collapsing the
 * last two into one `catch` loses the only distinction that changes what a person should do about it.
 */

/** A failed call surfaced to the user. `errorId` is the correlation handle every problem carries. */
export interface ApiProblem {
  status: number;
  /** The problem document's machine-readable type, when it sent one. */
  type?: string;
  /** The human-readable detail, when it sent one. Server-authored — never a raw exception. */
  detail?: string;
  errorId?: string;
}

export type ApiOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "problem"; problem: ApiProblem }
  | { kind: "transport" };

// Read the correlation handle and the server's own words off a problem document. Defensive: a body
// that is not JSON still yields a usable problem carrying the HTTP status.
async function readProblem(response: Response): Promise<ApiProblem> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    return {
      status: response.status,
      type: typeof body.type === "string" ? body.type : undefined,
      detail: typeof body.detail === "string" ? body.detail : undefined,
      errorId: typeof body.errorId === "string" ? body.errorId : undefined,
    };
  } catch {
    return { status: response.status };
  }
}

interface JsonRequest {
  readonly method?: "GET" | "POST" | "DELETE";
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
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.idempotencyKey !== undefined) headers["idempotency-key"] = request.idempotencyKey;

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    return { kind: "transport" };
  }

  if (!response.ok) return { kind: "problem", problem: await readProblem(response) };

  try {
    return { kind: "ok", value: (await response.json()) as T };
  } catch {
    return { kind: "transport" };
  }
}
