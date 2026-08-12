/*
 * The joining surface's transport seam — every call the registration and invitation screens make,
 * in one place and out of the components, so the branching is unit-testable without a DOM.
 *
 * These are same-origin `fetch` calls against the relative `/api/v1` paths. `apps/web` does not
 * depend on @magna-carta/api-client, so the shapes below are hand-written mirrors of the contract in
 * apps/worker/openapi/openapi.json — the same arrangement the Documents surface uses
 * (apps/web/src/lib/documents/document-api.ts) and the WHOIS tool before it. The duplication of the
 * small request helper across those three is deliberate for now: this surface is reached with no
 * session at all, and pointing the signed-out screens at a module that belongs to a signed-in
 * surface would be a worse dependency than a dozen repeated lines. When a fourth surface wants it,
 * the helper moves to one shared home and all four follow.
 *
 * Every call RESOLVES rather than throws. The three outcomes are different things to a person
 * standing at the front door — the server answered, the server refused, nothing answered at all —
 * and collapsing the last two into one `catch` loses the only distinction that changes what they
 * should do next.
 */

/** A refusal the server described. `errorId` is the correlation handle every problem carries. */
export interface JoiningProblem {
  status: number;
  /** The problem document's machine-readable type, when it sent one. */
  type?: string;
  /** The human-readable detail, when it sent one. Server-authored — never a raw exception. */
  detail?: string;
  errorId?: string;
  /**
   * How many attempts the caller has left. Published on a refused redemption and on a 429. Absent
   * when the server said nothing, which callers must render as nothing rather than as a full budget.
   */
  attemptsRemaining?: number;
  /** How long until the caller may try again, when the refusal came with a lockout. */
  retryAfterSeconds?: number;
}

export type JoiningOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "problem"; problem: JoiningProblem }
  | { kind: "transport" };

/** Which of the three doors the visitor came through. */
export type RegistrationRole = "clientOfFirm" | "firmMember" | "foundFirm";

export interface StartedRegistration {
  /** Where the surface goes next. Identical for every outcome within a door. */
  next: "checkEmail" | "redeemInvitation";
}

export interface ConfirmedRegistration {
  email: string;
  /** The firm is built off the request, so a confirmation reports "under way", not "here". */
  status: "provisioning";
}

export interface RedeemedInvitation {
  email: string;
  /** What the invitee becomes: a member of the firm, or a client of it. */
  kind: "firmMember" | "clientOfFirm";
  next: "checkEmail";
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Read the server's own words, the correlation handle and the attempt budget off a problem
// document. Defensive: a body that is not JSON still yields a usable problem carrying the status.
async function readProblem(response: Response): Promise<JoiningProblem> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    return {
      status: response.status,
      type: typeof body.type === "string" ? body.type : undefined,
      detail: typeof body.detail === "string" ? body.detail : undefined,
      errorId: typeof body.errorId === "string" ? body.errorId : undefined,
      attemptsRemaining: wholeNumber(body.attemptsRemaining),
      retryAfterSeconds: wholeNumber(body.retryAfterSeconds),
    };
  } catch {
    return { status: response.status };
  }
}

/** The one place a joining call is made. Never throws; a dead transport is its own outcome. */
async function postJson<T>(
  fetchImplementation: typeof fetch,
  path: string,
  body: unknown,
): Promise<JoiningOutcome<T>> {
  let response: Response;
  try {
    response = await fetchImplementation(path, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
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

export interface StartRegistrationInput {
  readonly role: RegistrationRole;
  readonly email: string;
  /** The person's own name, as one string — one display name is what the row holds. */
  readonly name: string;
  /** Read only on the founding door. Not unique, and never a lookup key. */
  readonly firmName?: string;
}

export function startRegistration(
  fetchImplementation: typeof fetch,
  input: StartRegistrationInput,
): Promise<JoiningOutcome<StartedRegistration>> {
  return postJson(fetchImplementation, "/api/v1/registrations", input);
}

export function confirmRegistration(
  fetchImplementation: typeof fetch,
  token: string,
): Promise<JoiningOutcome<ConfirmedRegistration>> {
  return postJson(fetchImplementation, "/api/v1/registrations/confirmations", {
    token: token.trim(),
  });
}

export interface RedeemInvitationInput {
  readonly code: string;
  readonly lastName: string;
  /** A calendar date in YYYY-MM-DD form, which is what the date field submits. */
  readonly dateOfBirth: string;
}

/**
 * Redeem an invitation. The three facts travel together and come back as ONE answer: the row holds
 * a single digest over all of them, so there is no per-field verdict to receive and none to render.
 */
export function redeemInvitation(
  fetchImplementation: typeof fetch,
  input: RedeemInvitationInput,
): Promise<JoiningOutcome<RedeemedInvitation>> {
  return postJson(fetchImplementation, "/api/v1/invitations/redemptions", input);
}
