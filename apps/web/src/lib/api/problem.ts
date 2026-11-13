/*
 * The problem document, as the app reads it — the one home for what a failed call means.
 *
 * THIS FILE EXISTS BECAUSE THE APP USED TO THROW AWAY MOST OF WHAT THE SERVER SAID. The contract
 * publishes twelve fields on an RFC 9457 problem (apps/api-worker/src/http/contracts/problem.ts); four of
 * them were being read and the rest were parsed off the response and dropped. Two of the dropped
 * ones name the member's next step — `requestAccess` says they may ask for access, `stepUpRequired`
 * says a fresh sign-in would work — so a screen that cannot see them turns a solvable situation into
 * "something went wrong". Everything here is read, and every surface renders from this record rather
 * than from a sentence squeezed out of it.
 *
 * These shapes stay hand-written even though `apps/web` now reads the contract through
 * @magna-carta/api-client, because they are not the contract: `Problem` is what a FAILURE SURFACE
 * renders from, assembled defensively out of whatever a failing call left behind. The generated
 * types describe a body the server meant to send; this describes what is knowable when it did not.
 * This module is the single home the joining, WHOIS and safe-browse transports each used to keep a
 * private copy of.
 */

/** One field-level rejection inside a validation problem. */
export interface ProblemFieldError {
  /** The field's path in the request body, as the contract names it. */
  readonly path: string;
  /** The machine-readable reason, for a surface that wants to branch on it. */
  readonly code: string;
  /** The server's own words for this field. */
  readonly detail: string;
}

/**
 * A failure the server described. Every field the contract can send, because the ones a surface does
 * not read today are exactly the ones the next surface needs.
 */
export interface Problem {
  /** The HTTP status. Always present — a body that will not parse still yields this much. */
  readonly status: number;
  /** The registered problem-type URI. The stable identity of the failure across releases. */
  readonly type?: string;
  /** The server's own short name for the failure. The natural heading when a surface has none. */
  readonly title?: string;
  /** The human-readable detail. Server-authored — never a raw exception. */
  readonly detail?: string;
  /** The user-facing correlation handle. Quoted in a report; maps to the redacted server trace. */
  readonly errorId?: string;
  /** The request-wide correlation handle, which finds the whole request rather than this one error. */
  readonly correlationId?: string;
  /** The specific occurrence this problem describes, where the server named one. */
  readonly instance?: string;
  /** Field-level rejections on a validation problem. */
  readonly errors?: readonly ProblemFieldError[];
  /** The member may ask for access to what they were refused. A next step, not a dead end. */
  readonly requestAccess?: boolean;
  /** A fresh sign-in would let this through. A next step, not a dead end. */
  readonly stepUpRequired?: boolean;
  /**
   * How many attempts the caller has left. Absent when the server said nothing, which a surface
   * renders as nothing rather than as a full budget.
   */
  readonly attemptsRemaining?: number;
  /** How long until the caller may try again, when the refusal came with a lockout. */
  readonly retryAfterSeconds?: number;
}

/**
 * What a failed call hands to a failure surface: the problem the server described, or its absence,
 * plus the two facts only the transport knows.
 *
 * `problem` is null when NOTHING ANSWERED — a dead link, a Worker that is not there, a body that
 * will not parse. That is a different thing to a refusal and the surfaces say so differently, which
 * is why the distinction survives all the way to the screen instead of being flattened into a
 * catch.
 *
 * `failedAt` is captured when the call fails rather than when the screen renders, so a failure left
 * on screen keeps reporting the moment it happened.
 */
export interface Failure {
  readonly problem: Problem | null;
  /** The call as the app made it, e.g. "GET /matters/mat_8QK2/costs". Never carries a body. */
  readonly request: string;
  readonly failedAt: Date;
  /**
   * For a crash in this browser: what was thrown and where, from crashSignature in
   * $lib/diagnostics/crash.ts. It is what turns a client Error ID into a line a developer can find,
   * because nothing about a client crash reaches a server log.
   */
  readonly cause?: string;
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function fieldErrors(value: unknown): readonly ProblemFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const errors = value.flatMap((entry): ProblemFieldError[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const path = text(record.path);
    const code = text(record.code);
    const detail = text(record.detail);
    if (path === undefined || code === undefined || detail === undefined) return [];
    return [{ path, code, detail }];
  });
  return errors.length > 0 ? errors : undefined;
}

/**
 * Read a problem document out of an already-parsed body, against the status the response carried.
 *
 * Split out from `readProblem` because the generated client throws the PARSED body rather than the
 * `Response` it came off (@magna-carta/api-client's fetch client parses the error body itself, then
 * throws it). Both entry points read the same twelve fields the same way, so a problem means the
 * same thing whichever transport carried it.
 */
export function problemOf(body: unknown, status: number): Problem {
  if (typeof body !== "object" || body === null) return { status };
  const record = body as Record<string, unknown>;
  return {
    status,
    type: text(record.type),
    title: text(record.title),
    detail: text(record.detail),
    errorId: text(record.errorId),
    correlationId: text(record.correlationId),
    instance: text(record.instance),
    errors: fieldErrors(record.errors),
    requestAccess: flag(record.requestAccess),
    stepUpRequired: flag(record.stepUpRequired),
    attemptsRemaining: wholeNumber(record.attemptsRemaining),
    retryAfterSeconds: wholeNumber(record.retryAfterSeconds),
  };
}

/**
 * Read a problem document off a response. Defensive throughout: a body that is not JSON, or that is
 * JSON of the wrong shape, still yields a usable problem carrying the HTTP status — a failure must
 * never fail to be describable.
 */
export async function readProblem(response: Response): Promise<Problem> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: response.status };
  }
  return problemOf(body, response.status);
}

/**
 * The request line a failure carries, built from the method and the path as the app called it.
 *
 * THE QUERY STRING IS DROPPED. It is the one part of a request that can hold whatever a person
 * typed — a search term, a WHOIS target, a filter naming a client — and this line is built to be
 * displayed, copied, and pasted into a report. Redact by default is a golden rule
 * (docs/conventions/error-logging.md), and it is not worth auditing a hundred routes to keep a
 * cursor. The path is kept in full: an opaque record identifier is what makes two failures
 * distinguishable, and it names a row rather than describing one.
 */
export function requestLine(method: string, path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  return `${method.toUpperCase()} ${withoutQuery.replace(/^\/api\/v1/, "")}`;
}
