import {
  guarded,
  type EffectStatement,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  SigningFieldId,
  SigningRequestId,
  SigningSignerId,
} from "@magna-carta/identifiers/types";
import {
  completionCounts,
  decline,
  isComplete,
  open,
  sign,
  type FieldAnswers,
  type SigningFieldKind,
} from "@magna-carta/signing/request";
import { CURRENT_CONSENT_VERSION } from "./consent-disclosure.ts";
import {
  SIGNING_GUARD,
  SigningRequestRefusal,
  deliveredStatements,
  event,
  readRequestDetail,
  stateOf,
  type SigningRequestDetail,
} from "./request-service.ts";
import {
  MAXIMUM_ACCESS_CODE_ATTEMPTS,
  countAccessCodeAttemptStatement,
  markIdentityVerifiedStatement,
  readSignerProgress,
  recordAccessCodeStatement,
  recordAdoptionStatement,
  recordConsentStatement,
  setFieldValueStatement,
  type SignerProgress,
} from "./signer-statements.ts";
import {
  insertEventStatement,
  updateRequestStatusStatement,
  updateSignerStatusStatement,
  type SigningSignerRow,
} from "./statements.ts";

// What an outside signer does: open the request, prove who they are with a code, agree to sign
// electronically, adopt a signature, and finish or decline. Each act returns the statements to commit
// and what the caller must do after the commit (whom to mail). The request model
// (@magna-carta/signing/request) decides every transition; this module reads, asks it, and writes.
//
// Every act is held to the signer's own steps in order. Whatever the page shows, the server refuses
// a consent before the code, a finish before the consent, and a signature field with no signature.

/** How long a mailed access code works. */
export const ACCESS_CODE_LIFETIME_MINUTES = 10;

/** The longest answer a text field takes. */
export const MAXIMUM_TEXT_ANSWER = 500;

/** Where an act was observed from: the edge's own reading, never the page's. */
export interface Observed {
  readonly now: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SignerView {
  readonly detail: SigningRequestDetail;
  readonly signer: SigningSignerRow;
  readonly progress: SignerProgress;
}

/** A signer's step taken out of turn: the page is told what to do instead. */
export class SignerStepRefusal extends Error {
  readonly status: 409 | 422;
  constructor(status: 409 | 422, message: string) {
    super(message);
    this.name = "SignerStepRefusal";
    this.status = status;
  }
}

export async function readSignerView(
  database: SqlDatabase,
  requestId: SigningRequestId,
  signerId: SigningSignerId,
): Promise<SignerView> {
  const [detail, progress] = await Promise.all([
    readRequestDetail(database, requestId),
    readSignerProgress(database, signerId),
  ]);
  const signer = detail?.signers.find((one) => one.id === signerId);
  if (detail === undefined || signer === undefined || progress === undefined) {
    throw new SigningRequestRefusal("not-found", "No such request.");
  }
  return { detail, signer, progress };
}

function seenFrom(observed: Observed): { observedIp: string | null; userAgent: string | null } {
  return { observedIp: observed.ip, userAgent: observed.userAgent };
}

/** Whether the signer still owes the emailed code before anything else. */
export function needsCode(view: SignerView): boolean {
  return (
    view.signer.attributionLevel === "access-code" && view.progress.identityVerifiedAt === null
  );
}

const write = (statements: EffectStatement[]): EffectWrite => ({ statements, outboxMessages: [] });

/** Opening the page: the first time, the signer is marked as having opened it. */
export function openRequest(
  database: SqlDatabase,
  view: SignerView,
  observed: Observed,
): EffectWrite {
  const outcome = open(stateOf(view.detail), view.signer.id);
  if (!outcome.ok) throw new SignerStepRefusal(409, outcome.reason);
  if (view.signer.status !== "notified") return write([]);
  return write([
    guarded(
      updateSignerStatusStatement(database, view.signer.id, "notified", "opened", observed.now),
      SIGNING_GUARD.moved,
    ),
    insertEventStatement(
      database,
      event(view.detail.request.id, "viewed", observed.now, {
        signerId: view.signer.id,
        actor: view.signer.name,
        ...seenFrom(observed),
      }),
    ),
  ]);
}

function assertTurn(view: SignerView): void {
  const outcome = open(stateOf(view.detail), view.signer.id);
  if (!outcome.ok) throw new SignerStepRefusal(409, outcome.reason);
}

/** A fresh code for a signer who proves who they are with one. The caller mails the digits. */
export function issueAccessCode(
  database: SqlDatabase,
  view: SignerView,
  codeHash: string,
  observed: Observed,
): EffectWrite {
  assertTurn(view);
  if (!needsCode(view))
    throw new SignerStepRefusal(409, "No code is needed to sign this document.");
  const expiresAt = new Date(
    Date.parse(observed.now) + ACCESS_CODE_LIFETIME_MINUTES * 60_000,
  ).toISOString();
  return write([
    recordAccessCodeStatement(database, view.signer.id, codeHash, expiresAt, observed.now),
  ]);
}

/**
 * A code entered. The right one, in time and with tries left, verifies the signer; a wrong one
 * spends a try. The comparison is the caller's, constant-time, over the keyed digests.
 */
export function checkAccessCode(
  database: SqlDatabase,
  view: SignerView,
  matches: boolean,
  observed: Observed,
): { readonly effect: EffectWrite; readonly verified: boolean } {
  assertTurn(view);
  if (!needsCode(view)) return { effect: write([]), verified: true };
  const { accessCodeHash, accessCodeExpiresAt, accessCodeAttempts } = view.progress;
  if (accessCodeHash === null || accessCodeExpiresAt === null) {
    throw new SignerStepRefusal(409, "Ask for a code first. It is sent to your email address.");
  }
  if (accessCodeAttempts >= MAXIMUM_ACCESS_CODE_ATTEMPTS) {
    throw new SignerStepRefusal(409, "Too many wrong codes. Ask for a new code.");
  }
  if (Date.parse(accessCodeExpiresAt) <= Date.parse(observed.now)) {
    throw new SignerStepRefusal(409, "This code has expired. Ask for a new code.");
  }
  if (!matches) {
    return {
      verified: false,
      effect: write([
        guarded(
          countAccessCodeAttemptStatement(
            database,
            view.signer.id,
            accessCodeAttempts,
            observed.now,
          ),
          SIGNING_GUARD.moved,
        ),
      ]),
    };
  }
  return {
    verified: true,
    effect: write([
      guarded(
        markIdentityVerifiedStatement(database, view.signer.id, accessCodeAttempts, observed.now),
        SIGNING_GUARD.moved,
      ),
      insertEventStatement(
        database,
        event(view.detail.request.id, "identity-verified", observed.now, {
          signerId: view.signer.id,
          actor: view.signer.name,
          detail: "email code",
          ...seenFrom(observed),
        }),
      ),
    ]),
  };
}

/** The signer agreed to sign electronically, under the current disclosure. */
export function giveConsent(
  database: SqlDatabase,
  view: SignerView,
  observed: Observed,
): EffectWrite {
  assertTurn(view);
  if (needsCode(view)) throw new SignerStepRefusal(409, "Enter the code sent to your email first.");
  if (view.signer.consentedAt !== null) return write([]);
  return write([
    guarded(
      recordConsentStatement(database, view.signer.id, CURRENT_CONSENT_VERSION, observed.now),
      SIGNING_GUARD.moved,
    ),
    insertEventStatement(
      database,
      event(view.detail.request.id, "consented", observed.now, {
        signerId: view.signer.id,
        actor: view.signer.name,
        detail: `disclosure ${CURRENT_CONSENT_VERSION}`,
        ...seenFrom(observed),
      }),
    ),
  ]);
}

function assertReadyToSign(view: SignerView): void {
  assertTurn(view);
  if (needsCode(view)) throw new SignerStepRefusal(409, "Enter the code sent to your email first.");
  if (view.signer.consentedAt === null) {
    throw new SignerStepRefusal(409, "Agree to sign electronically first.");
  }
}

/** The adopted signature and initials, already written to the firm's bucket by the caller. */
export function adoptSignature(
  database: SqlDatabase,
  view: SignerView,
  adoption: {
    readonly how: "typed" | "drawn" | "uploaded";
    readonly signatureKey: string;
    readonly initialsKey: string | null;
  },
  observed: Observed,
): EffectWrite {
  assertReadyToSign(view);
  return write([
    guarded(
      recordAdoptionStatement(
        database,
        view.signer.id,
        adoption.how,
        adoption.signatureKey,
        adoption.initialsKey,
        observed.now,
      ),
      SIGNING_GUARD.moved,
    ),
  ]);
}

/** The answer each of the signer's fields is stored with. */
function storedAnswer(
  kind: SigningFieldKind,
  view: SignerView,
  answer: string | boolean | undefined,
  now: string,
): string | null {
  switch (kind) {
    case "date-signed":
      // The instant itself; the seal writes it as a date in the request's zone.
      return now;
    case "full-name":
      return view.signer.name;
    case "signature":
    case "initials":
      return "adopted";
    case "checkbox":
      return answer === true ? "checked" : "unchecked";
    default:
      return typeof answer === "string" && answer.trim() !== "" ? answer.trim() : null;
  }
}

/**
 * Finishing: every one of the signer's fields checked against what they gave, the answers written,
 * the signer marked signed, and the request moved on, to the next signer or to completed.
 */
export function finishSigning(
  database: SqlDatabase,
  view: SignerView,
  answers: FieldAnswers,
  observed: Observed,
): {
  readonly effect: EffectWrite;
  readonly notify: readonly SigningSignerRow[];
  readonly completed: boolean;
} {
  assertReadyToSign(view);
  const own = view.detail.fields.filter((field) => field.signerId === view.signer.id);
  const ownIds = new Set<string>(own.map((field) => field.id));
  for (const key of Object.keys(answers)) {
    if (!ownIds.has(key))
      throw new SignerStepRefusal(422, "An answer was given for a field that is not yours.");
  }
  const needsMarks = own.some((field) => field.kind === "signature" || field.kind === "initials");
  if (needsMarks && view.signer.signatureObjectKey === null) {
    throw new SignerStepRefusal(409, "Adopt your signature first.");
  }
  if (own.some((field) => field.kind === "initials") && view.signer.initialsObjectKey === null) {
    throw new SignerStepRefusal(409, "Adopt your initials first.");
  }
  // A signature or initials box is complete once something is adopted for it.
  const effective: Record<string, string | boolean> = { ...answers };
  for (const field of own) {
    if (field.kind === "signature" || field.kind === "initials") effective[field.id] = true;
    const answer = effective[field.id];
    if (typeof answer === "string" && answer.length > MAXIMUM_TEXT_ANSWER) {
      throw new SignerStepRefusal(
        422,
        `An answer is longer than ${MAXIMUM_TEXT_ANSWER} characters.`,
      );
    }
  }
  const incomplete = own.filter((field) => !isComplete(field, effective));
  if (incomplete.length > 0) {
    throw new SignerStepRefusal(
      422,
      incomplete.length === 1
        ? "One required field is empty."
        : `${incomplete.length} required fields are empty.`,
    );
  }

  const state = stateOf(view.detail);
  const outcome = sign(state, view.signer.id);
  if (!outcome.ok) throw new SignerStepRefusal(409, outcome.reason);

  const requestId = view.detail.request.id;
  const statements: EffectStatement[] = [];
  for (const field of own) {
    const stored = storedAnswer(field.kind, view, effective[field.id], observed.now);
    if (stored !== null) {
      statements.push(
        setFieldValueStatement(
          database,
          field.id as SigningFieldId,
          view.signer.id,
          stored,
          observed.now,
        ),
      );
    }
  }
  const counts = completionCounts(state.fields, view.signer.id);
  statements.push(
    guarded(
      updateSignerStatusStatement(
        database,
        view.signer.id,
        view.signer.status,
        "signed",
        observed.now,
      ),
      SIGNING_GUARD.moved,
    ),
    insertEventStatement(
      database,
      event(requestId, "signed", observed.now, {
        signerId: view.signer.id,
        actor: view.signer.name,
        detail: `${counts.signatureCount} ${counts.signatureCount === 1 ? "signature" : "signatures"}, ${counts.initialCount} initials`,
        ...seenFrom(observed),
      }),
    ),
  );
  const notifyIds = new Set(outcome.notify.map((signer) => signer.id));
  const notify = view.detail.signers.filter((signer) => notifyIds.has(signer.id));
  statements.push(...deliveredStatements(database, requestId, notify, observed.now));
  const completed = outcome.request.status === "completed";
  if (completed) {
    statements.push(
      guarded(
        updateRequestStatusStatement(database, requestId, "sent", "completed", observed.now),
        SIGNING_GUARD.moved,
      ),
      insertEventStatement(database, event(requestId, "completed", observed.now)),
    );
  }
  return { effect: write(statements), notify, completed };
}

/** Declining ends the request for everyone; the reason is kept on the record. */
export function declineSigning(
  database: SqlDatabase,
  view: SignerView,
  reason: string,
  observed: Observed,
): EffectWrite {
  const outcome = decline(stateOf(view.detail), view.signer.id);
  if (!outcome.ok) throw new SignerStepRefusal(409, outcome.reason);
  const requestId = view.detail.request.id;
  const kept = reason.trim() === "" ? null : reason.trim();
  return write([
    guarded(
      updateSignerStatusStatement(
        database,
        view.signer.id,
        view.signer.status,
        "declined",
        observed.now,
        kept,
      ),
      SIGNING_GUARD.moved,
    ),
    guarded(
      updateRequestStatusStatement(database, requestId, "sent", "declined", observed.now),
      SIGNING_GUARD.moved,
    ),
    insertEventStatement(
      database,
      event(requestId, "declined", observed.now, {
        signerId: view.signer.id,
        actor: view.signer.name,
        ...seenFrom(observed),
      }),
    ),
  ]);
}
