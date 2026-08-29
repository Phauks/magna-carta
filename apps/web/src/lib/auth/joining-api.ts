/*
 * The joining surface's transport seam — every call the registration and invitation screens make,
 * in one place and out of the components, so the branching is unit-testable without a DOM.
 *
 * These are same-origin `fetch` calls against the relative `/api/v1` paths. `apps/web` does not
 * depend on @magna-carta/api-client, so the shapes below are hand-written mirrors of the contract in
 * apps/api-worker/openapi/openapi.json — the same arrangement the Documents surface uses
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

/**
 * What is being registered. `account` registers a PERSON and is what this surface sends: confirming
 * it creates their account, and which firm they belong to is settled afterwards, signed in, on the
 * joining screen. The other three are the superseded role fork, kept only so a registration started
 * before the reflow still completes.
 */
export type RegistrationRole = "account" | "clientOfFirm" | "firmMember" | "foundFirm";

export interface StartedRegistration {
  /** Where the surface goes next. Identical for every outcome within a door. */
  next: "checkEmail" | "redeemInvitation";
}

export interface ConfirmedRegistration {
  email: string;
  /**
   * What the spent token bought. `accountCreated` — the account exists and the link that sets its
   * password is on its way. `provisioning` — a registration from the superseded founding door,
   * whose firm is built off the request, so it reports "under way", not "here".
   */
  status: "accountCreated" | "provisioning";
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
  /** Omitted by the account door, which is what this surface sends. */
  readonly role?: RegistrationRole;
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

/*
 * THE SIGNED-IN HALF. Everything above is reached with no session at all; everything below is
 * reached by somebody who has an account and does not yet belong to a firm. They share this module
 * because they are one act — joining — and splitting them by whether a cookie happens to be present
 * would put the two halves of one flow in two places.
 */

/** What the bootstrap says about somebody who has not joined a firm yet. */
export interface JoiningStatus {
  /** `chooseFirm` — nothing is under way. `firmProvisioning` — their firm is being built. */
  state: "chooseFirm" | "firmProvisioning";
}

export interface Bootstrap {
  user: { id: string; name: string; email: string };
  /** Null for a person who belongs to no firm — the state the joining screen exists for. */
  firm: { id: string; name: string } | null;
  joining?: JoiningStatus;
}

/**
 * The bootstrap read, as the joining surface needs it: who this is, and whether they have a firm
 * yet. The signed-in screens poll this rather than a status endpoint of their own, so a person who
 * closes the tab while their firm builds reopens onto the same waiting screen.
 */
export async function readBootstrap(
  fetchImplementation: typeof fetch,
): Promise<JoiningOutcome<Bootstrap>> {
  let response: Response;
  try {
    response = await fetchImplementation("/api/v1/me", { headers: { accept: "application/json" } });
  } catch {
    return { kind: "transport" };
  }
  if (!response.ok) return { kind: "problem", problem: await readProblem(response) };
  try {
    return { kind: "ok", value: (await response.json()) as Bootstrap };
  } catch {
    return { kind: "transport" };
  }
}

export interface FoundFirmStarted {
  /** The firm is built off the request, so this reports "under way", never "here". */
  status: "provisioning";
}

/** Ask for a firm, with the signed-in account as its owner. */
export function foundFirm(
  fetchImplementation: typeof fetch,
  firmName: string,
): Promise<JoiningOutcome<FoundFirmStarted>> {
  return postJson(fetchImplementation, "/api/v1/me/firm", { firmName: firmName.trim() });
}

export interface RedeemedIntoAccount {
  firmId: string;
  kind: "firmMember" | "clientOfFirm";
}

/**
 * Redeem an invitation into the account already signed in. The three facts travel together and come
 * back as ONE answer, exactly as on the anonymous door: the row holds a single digest over all of
 * them, so there is no per-field verdict to receive and none to render.
 */
export function redeemInvitationIntoAccount(
  fetchImplementation: typeof fetch,
  input: RedeemInvitationInput,
): Promise<JoiningOutcome<RedeemedIntoAccount>> {
  return postJson(fetchImplementation, "/api/v1/me/invitation-redemptions", input);
}
