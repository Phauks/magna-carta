// A signing request from the moment a member prepares it to the moment the last signer finishes:
// who signs, in what order, which fields each completes, and what each event does to the request.
//
// Every transition is a pure function of the request as it stands, so the routes persist what this
// module decides and never decide it themselves. A transition the request's state does not allow is
// refused with a reason rather than quietly ignored, because a signing record that skipped a step is
// a record that cannot be defended.

import type { AttributionLevel } from "./esign.ts";

/** Whether signers are asked one after another, or all at once. */
export type SigningOrder = "in-order" | "all-at-once";

export type RequestStatus = "draft" | "sent" | "completed" | "declined" | "voided" | "expired";

export type SignerStatus = "waiting" | "notified" | "opened" | "signed" | "declined";

/** What a field holds. The first two are drawn from the adopted signature; the rest are text. */
export type SigningFieldKind =
  | "signature"
  | "initials"
  | "date-signed"
  | "full-name"
  | "text"
  | "checkbox";

export const SIGNING_FIELD_KINDS: readonly SigningFieldKind[] = [
  "signature",
  "initials",
  "date-signed",
  "full-name",
  "text",
  "checkbox",
];

/** Fields the request fills by itself when the signer finishes; the signer never types them. */
export const SELF_FILLING_KINDS: ReadonlySet<SigningFieldKind> = new Set([
  "date-signed",
  "full-name",
]);

/** The ways a signer can prove who they are that this build offers. */
export const OFFERED_ATTRIBUTION: readonly AttributionLevel[] = [
  "email-link",
  "access-code",
  "firm-authenticated",
];

/** A field on a page, in PDF points with the origin at the page's bottom left. */
export interface SigningField {
  readonly id: string;
  readonly signerId: string;
  readonly kind: SigningFieldKind;
  /** Counted from 1, as the engine counts pages. */
  readonly page: number;
  readonly rect: readonly [left: number, bottom: number, right: number, top: number];
  readonly required: boolean;
}

export interface RequestSigner {
  readonly id: string;
  /** Counted from 1: the order signers are asked in when the request is in order. */
  readonly position: number;
  readonly name: string;
  readonly email: string;
  readonly attribution: AttributionLevel;
  /** The member who signs, for `firm-authenticated` only. */
  readonly userId?: string;
  readonly status: SignerStatus;
}

export interface SigningRequestState {
  readonly status: RequestStatus;
  readonly order: SigningOrder;
  readonly signers: readonly RequestSigner[];
  readonly fields: readonly SigningField[];
  /** ISO 8601. */
  readonly expiresAt: string;
}

/** The smallest field, in points, a mark can be drawn in legibly. */
export const MINIMUM_FIELD_SIZE_PT = 8;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What stops a draft being sent, as sentences a member can act on. Empty means it can be sent. */
export function draftProblems(request: SigningRequestState, pageCount: number): string[] {
  const problems: string[] = [];
  if (request.status !== "draft") problems.push("This request has already been sent.");
  if (request.signers.length === 0) problems.push("Add at least one signer.");
  const ids = new Set(request.signers.map((signer) => signer.id));
  for (const signer of request.signers) {
    const who = signer.name.trim() === "" ? `Signer ${signer.position}` : signer.name.trim();
    if (signer.name.trim() === "") problems.push(`Signer ${signer.position} needs a name.`);
    if (!OFFERED_ATTRIBUTION.includes(signer.attribution)) {
      problems.push(`${who} has a way of proving identity that is not offered yet.`);
    }
    if (signer.attribution === "firm-authenticated") {
      if (signer.userId === undefined) problems.push(`Choose which firm member ${who} is.`);
    } else if (!EMAIL.test(signer.email.trim())) {
      problems.push(`${who} needs an email address the request can be sent to.`);
    }
    const own = request.fields.filter((field) => field.signerId === signer.id);
    if (!own.some((field) => field.kind === "signature")) {
      problems.push(`Place at least one signature field for ${who}.`);
    }
  }
  for (const field of request.fields) {
    if (!ids.has(field.signerId)) problems.push("A field belongs to a signer who was removed.");
    if (!Number.isInteger(field.page) || field.page < 1 || field.page > pageCount) {
      problems.push(`A field is on page ${field.page}, and this document has ${pageCount}.`);
    }
    const [left, bottom, right, top] = field.rect;
    if (right - left < MINIMUM_FIELD_SIZE_PT || top - bottom < MINIMUM_FIELD_SIZE_PT) {
      problems.push(`A field on page ${field.page} is too small to sign in.`);
    }
  }
  return [...new Set(problems)];
}

/** Signers ordered by position. */
function byPosition(signers: readonly RequestSigner[]): RequestSigner[] {
  return signers.toSorted((first, second) => first.position - second.position);
}

/** Who is asked to sign next: everyone yet to be asked when all at once, the next one when in order. */
export function signersToNotify(request: SigningRequestState): RequestSigner[] {
  const waiting = byPosition(request.signers).filter((signer) => signer.status === "waiting");
  if (request.order === "all-at-once") return waiting;
  const busy = request.signers.some(
    (signer) => signer.status === "notified" || signer.status === "opened",
  );
  return busy ? [] : waiting.slice(0, 1);
}

export type Transition =
  | { readonly ok: true; readonly request: SigningRequestState; readonly notify: RequestSigner[] }
  | { readonly ok: false; readonly reason: string };

function withSigner(
  request: SigningRequestState,
  signerId: string,
  status: SignerStatus,
): SigningRequestState {
  return {
    ...request,
    signers: request.signers.map((signer) =>
      signer.id === signerId ? { ...signer, status } : signer,
    ),
  };
}

function notified(request: SigningRequestState, signers: RequestSigner[]): SigningRequestState {
  const ids = new Set(signers.map((signer) => signer.id));
  return {
    ...request,
    signers: request.signers.map((signer) =>
      ids.has(signer.id) ? { ...signer, status: "notified" } : signer,
    ),
  };
}

/** The reason a request that is not out for signing refuses a signer's step. */
function closedReason(status: RequestStatus): string | null {
  switch (status) {
    case "sent":
      return null;
    case "draft":
      return "This request has not been sent yet.";
    case "completed":
      return "Everyone has already signed this document.";
    case "declined":
      return "This request was declined, so it can no longer be signed.";
    case "voided":
      return "The sender cancelled this request.";
    case "expired":
      return "This request has expired. Ask the sender for a new one.";
  }
}

/** Send a draft: it is out for signing, and the first signers are asked. */
export function send(request: SigningRequestState, pageCount: number): Transition {
  const problems = draftProblems(request, pageCount);
  if (problems.length > 0) return { ok: false, reason: problems[0] ?? "" };
  const sent: SigningRequestState = { ...request, status: "sent" };
  const notify = signersToNotify(sent);
  return { ok: true, request: notified(sent, notify), notify };
}

/** A signer opened the document. Opening twice changes nothing. */
export function open(request: SigningRequestState, signerId: string): Transition {
  const closed = closedReason(request.status);
  if (closed !== null) return { ok: false, reason: closed };
  const signer = request.signers.find((one) => one.id === signerId);
  if (signer === undefined) return { ok: false, reason: "This signer is not on the request." };
  if (signer.status === "waiting") {
    return {
      ok: false,
      reason: "It is not your turn to sign yet. You will get an email when it is.",
    };
  }
  if (signer.status !== "notified") return { ok: true, request, notify: [] };
  return { ok: true, request: withSigner(request, signerId, "opened"), notify: [] };
}

/** A signer finished. When they are the last, the request is complete; otherwise the next is asked. */
export function sign(request: SigningRequestState, signerId: string): Transition {
  const closed = closedReason(request.status);
  if (closed !== null) return { ok: false, reason: closed };
  const signer = request.signers.find((one) => one.id === signerId);
  if (signer === undefined) return { ok: false, reason: "This signer is not on the request." };
  if (signer.status === "signed") return { ok: false, reason: "You have already signed." };
  if (signer.status !== "notified" && signer.status !== "opened") {
    return { ok: false, reason: "It is not your turn to sign yet." };
  }
  const after = withSigner(request, signerId, "signed");
  if (after.signers.every((one) => one.status === "signed")) {
    return { ok: true, request: { ...after, status: "completed" }, notify: [] };
  }
  const notify = signersToNotify(after);
  return { ok: true, request: notified(after, notify), notify };
}

/** A signer declined. One refusal ends the request, because the document can no longer be complete. */
export function decline(request: SigningRequestState, signerId: string): Transition {
  const closed = closedReason(request.status);
  if (closed !== null) return { ok: false, reason: closed };
  const signer = request.signers.find((one) => one.id === signerId);
  if (signer === undefined) return { ok: false, reason: "This signer is not on the request." };
  if (signer.status === "signed") return { ok: false, reason: "You have already signed." };
  if (signer.status === "waiting") return { ok: false, reason: "It is not your turn to sign yet." };
  return {
    ok: true,
    request: { ...withSigner(request, signerId, "declined"), status: "declined" },
    notify: [],
  };
}

/** A member cancelled the request. Only a request still out for signing, or a draft, can be. */
export function voidRequest(request: SigningRequestState): Transition {
  if (request.status !== "sent" && request.status !== "draft") {
    return { ok: false, reason: "Only a request that is still out for signing can be cancelled." };
  }
  return { ok: true, request: { ...request, status: "voided" }, notify: [] };
}

/** Whether a request still out for signing has passed its expiry. */
export function hasExpired(request: SigningRequestState, now: Date): boolean {
  return request.status === "sent" && Date.parse(request.expiresAt) <= now.getTime();
}

/** One signer's fields in the order they are met: by page, then down the page, then across. */
export function fieldsInReadingOrder(
  fields: readonly SigningField[],
  signerId: string,
): SigningField[] {
  return fields
    .filter((field) => field.signerId === signerId)
    .toSorted(
      (first, second) =>
        first.page - second.page ||
        second.rect[3] - first.rect[3] ||
        first.rect[0] - second.rect[0],
    );
}

/** A signer's answers, keyed by field id. Signature and initials fields hold `true` once placed. */
export type FieldAnswers = Readonly<Record<string, string | boolean>>;

/** Whether a field has what it needs. Self-filling fields always have. */
export function isComplete(field: SigningField, answers: FieldAnswers): boolean {
  if (SELF_FILLING_KINDS.has(field.kind)) return true;
  const answer = answers[field.id];
  if (field.kind === "checkbox") return !field.required || answer === true;
  if (field.kind === "signature" || field.kind === "initials") return answer === true;
  return !field.required || (typeof answer === "string" && answer.trim() !== "");
}

/** The next field this signer still has to complete, or null when they can finish. */
export function nextField(
  fields: readonly SigningField[],
  signerId: string,
  answers: FieldAnswers,
): SigningField | null {
  return (
    fieldsInReadingOrder(fields, signerId).find((field) => !isComplete(field, answers)) ?? null
  );
}

/** How many signature and initials blocks a signer completes, as the certificate prints them. */
export function completionCounts(
  fields: readonly SigningField[],
  signerId: string,
): { readonly signatureCount: number; readonly initialCount: number } {
  const own = fields.filter((field) => field.signerId === signerId);
  return {
    signatureCount: own.filter((field) => field.kind === "signature").length,
    initialCount: own.filter((field) => field.kind === "initials").length,
  };
}
