/*
 * The joining surface's transport seam — every call the registration and invitation screens make,
 * in one place and out of the components, so the branching is unit-testable without a DOM.
 *
 * These are same-origin `fetch` calls against the relative `/api/v1` paths, made through the app's
 * one transport seam ($lib/api/request.ts). This surface kept a private copy of that helper while
 * only three surfaces wanted it; the copy is gone now that there is a shared home, and with it the
 * reason it had grown apart — it read `attemptsRemaining` and `retryAfterSeconds` because the shared
 * parser used to drop them, and the shared parser reads every field the contract sends.
 *
 * Every call RESOLVES rather than throws. The three outcomes are different things to a person
 * standing at the front door — the server answered, the server refused, nothing answered at all —
 * and collapsing the last two into one `catch` loses the only distinction that changes what they
 * should do next.
 */

import { requestJson, type ApiOutcome, type Problem } from "$lib/api/request.ts";
import type { FirmBuildFacts } from "./firm-build-progress.ts";

/**
 * A refusal the server described. The shared problem record — named here for the screens that read
 * it, because on this surface a refusal is a security decision and the local name is what the tests
 * and the message mapping talk about.
 */
export type JoiningProblem = Problem;

export type JoiningOutcome<T> = ApiOutcome<T>;

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
   * What the spent token bought. `accountCreated` — the account exists, holding the password chosen
   * at registration. `provisioning` — a registration from the superseded founding door, whose firm
   * is built off the request, so it reports "under way", not "here".
   */
  status: "accountCreated" | "provisioning";
  /**
   * Where the person goes, which is a fact about whether they already hold a password. `signIn` —
   * the credential exists; the ordinary answer now. `checkEmail` — a registration started before
   * passwords were chosen at registration, whose password-setting link has been asked for.
   */
  next: "signIn" | "checkEmail";
}

export interface RedeemedInvitation {
  email: string;
  /** What the invitee becomes: a member of the firm, or a client of it. */
  kind: "firmMember" | "clientOfFirm";
  next: "checkEmail";
}

export interface StartRegistrationInput {
  /** Omitted by the account door, which is what this surface sends. */
  readonly role?: RegistrationRole;
  readonly email: string;
  /** The person's own name, as one string — one display name is what the row holds. */
  readonly name: string;
  /**
   * The password being chosen. Sent verbatim — never trimmed, never normalised: whitespace is part
   * of a password, and altering it here would set a credential the person did not type. Required by
   * the doors that create an account, which is every door this surface uses.
   */
  readonly password?: string;
  /** Read only on the founding door. Not unique, and never a lookup key. */
  readonly firmName?: string;
}

export function startRegistration(
  fetchImplementation: typeof fetch,
  input: StartRegistrationInput,
): Promise<JoiningOutcome<StartedRegistration>> {
  return requestJson(fetchImplementation, "/api/v1/registrations", {
    method: "POST",
    body: input,
  });
}

export function confirmRegistration(
  fetchImplementation: typeof fetch,
  token: string,
): Promise<JoiningOutcome<ConfirmedRegistration>> {
  return requestJson(fetchImplementation, "/api/v1/registrations/confirmations", {
    method: "POST",
    body: { token: token.trim() },
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
  return requestJson(fetchImplementation, "/api/v1/invitations/redemptions", {
    method: "POST",
    body: input,
  });
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
  /**
   * How far the build has got, present only while one is under way. The fields are ordered as the
   * platform performs them and each is monotone, so the first false is the step in flight; the words
   * for them live in ./firm-build-progress.ts, which is what the waiting screen reads.
   */
  build?: FirmBuildFacts;
}

/**
 * Whether this account's member record has reached its firm's own database — present only alongside
 * a firm, and the difference between a workspace that works and one that refuses every screen.
 * `provisioning` is a wait, `stalled` is that write having been given up on, and `unknown` is a read
 * that did not answer.
 */
export interface MembershipStatus {
  state: "active" | "provisioning" | "stalled" | "unknown";
}

export interface Bootstrap {
  user: { id: string; name: string; email: string };
  /** Null for a person who belongs to no firm — the state the joining screen exists for. */
  firm: { id: string; name: string } | null;
  joining?: JoiningStatus;
  membership?: MembershipStatus;
}

/**
 * The bootstrap read, as the joining surface needs it: who this is, and whether they have a firm
 * yet. The signed-in screens poll this rather than a status endpoint of their own, so a person who
 * closes the tab while their firm builds reopens onto the same waiting screen.
 */
export function readBootstrap(
  fetchImplementation: typeof fetch,
): Promise<JoiningOutcome<Bootstrap>> {
  return requestJson(fetchImplementation, "/api/v1/me");
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
  return requestJson(fetchImplementation, "/api/v1/me/firm", {
    method: "POST",
    body: { firmName: firmName.trim() },
  });
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
  return requestJson(fetchImplementation, "/api/v1/me/invitation-redemptions", {
    method: "POST",
    body: input,
  });
}
