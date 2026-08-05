import type { UserId } from "@magna-carta/identifiers/types";
import type { CustodyReleasePolicy } from "./settings.ts";
import type { CustodyMovementKind } from "./types.ts";
import { CustodyValidationError } from "./validation.ts";

// THE RELEASE GATE. Everywhere else in this subsystem, recording is not gating: a check-out is
// frictionless because friction on the daily path produces a register nobody keeps. Release is the
// exception, and it is the exception for one reason — it is the only movement that is irreversible
// from the firm's side. A packet checked out to the wrong person can be chased; an original handed
// over is gone, and the question afterwards is always the same two: on what authority did it leave,
// and how did you know that was the right person.
//
// So the gate is a PRECONDITION ON THE WRITE PATH THAT ALREADY RECORDS THE BORROWER, not a second
// path. `recordCustodyMovement` remains the one place a state change happens; a release is that path
// with more required of it. A separate "release" endpoint would be a second place the append-only
// invariant, the derived status, and the audit row all have to be right.
//
// What the gate does NOT do is decide what authority is good enough. That is jurisdiction-specific —
// a grant of probate, letters of administration, a power of attorney and the fact that one dies with
// its grantor — and this package encodes none of it. The basis is what the firm asserts, in the
// firm's words, and the register's job is to make sure something was asserted and to freeze it.

// The capture a caller supplies with a `released` movement.
export interface CustodyReleaseAuthorizationInput {
  // The authority the release is made on, in the firm's own words. No vocabulary, no catalog.
  readonly authorityBasis: string;
  // How the collector was identified. An assertion about the check that was made — the ledger row is
  // append-only and can never be edited or removed, so a document's numbers written here are
  // permanent, and nothing about the register needs them.
  readonly identityEvidence: string;
  // The firm member who made that check.
  readonly identityVerifiedByUserId: UserId;
  // The second signatory. Required only when the firm's policy asks for two.
  readonly witnessedByUserId?: UserId | null;
}

// The capture as the ledger row stores it: trimmed, complete, and with the optional signatory
// resolved to an explicit null rather than an absent key.
export interface CustodyReleaseCapture {
  readonly authorityBasis: string;
  readonly identityEvidence: string;
  readonly identityVerifiedByUserId: UserId;
  readonly witnessedByUserId: UserId | null;
}

// Whether the movement being recorded names someone the property went to. The borrower columns carry
// the recipient of a release exactly as they carry the holder of a check-out — one shape, because
// "who has it" is the same question in both cases.
export interface CustodyReleaseRecipient {
  readonly named: boolean;
}

export function resolveCustodyReleaseCapture(
  kind: CustodyMovementKind,
  authorization: CustodyReleaseAuthorizationInput | null | undefined,
  policy: CustodyReleasePolicy,
  recipient: CustodyReleaseRecipient,
): CustodyReleaseCapture | null {
  if (kind !== "released") {
    if (authorization == null) return null;
    // Release capture hung on a move or a check-out would read as evidence of a check nobody made,
    // on a row nothing gates. The database refuses it too; this turns that abort into a named
    // refusal a caller can act on.
    throw new CustodyValidationError(
      "custody-invalid-movement",
      "release authority and identity belong only to a released movement",
    );
  }

  if (!recipient.named) {
    throw new CustodyValidationError(
      "custody-release-not-authorized",
      "a release must name who collected the property — a member, a Directory entity, or a named individual",
    );
  }
  if (authorization == null) {
    throw new CustodyValidationError(
      "custody-release-not-authorized",
      "a release records the authority it is made on and the identity check made before the property left",
    );
  }

  const authorityBasis = authorization.authorityBasis.trim();
  if (authorityBasis.length === 0) {
    throw new CustodyValidationError(
      "custody-release-not-authorized",
      "a release records the authority it is made on, in the firm's own words",
    );
  }
  const identityEvidence = authorization.identityEvidence.trim();
  if (identityEvidence.length === 0) {
    throw new CustodyValidationError(
      "custody-release-not-authorized",
      "a release records how the person collecting the property was identified",
    );
  }

  const witnessedByUserId = authorization.witnessedByUserId ?? null;
  if (policy.requireTwoSignatories && witnessedByUserId === null) {
    throw new CustodyValidationError(
      "custody-release-not-authorized",
      "this firm requires two signatories on a release, and this one names only the member who checked identity",
    );
  }
  if (witnessedByUserId !== null && witnessedByUserId === authorization.identityVerifiedByUserId) {
    throw new CustodyValidationError(
      "custody-release-signatories-must-differ",
      "two signatories means two people — the witness cannot be the member who checked identity",
    );
  }

  return {
    authorityBasis,
    identityEvidence,
    identityVerifiedByUserId: authorization.identityVerifiedByUserId,
    witnessedByUserId,
  };
}
