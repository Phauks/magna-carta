/*
 * Whether the firm MAY use a contact point, and whether it SHOULD — and whether the firm has
 * confirmed the contact point is still true.
 *
 * These are the two facts a contact record was missing, and they are not one fact. A person can be
 * reachable at a number they would rather the firm did not ring; a person can ask to be reached by
 * post while still holding an email address the firm is welcome to use. So:
 *
 *   PERMITTED (can)   — may the firm use this contact point at all. Default yes. A contact point the
 *                       person asked the firm not to use is recorded with the permission withdrawn
 *                       and a note saying so, rather than deleted: deleting it loses the instruction
 *                       along with the value, and the next member re-enters the number and rings it.
 *   PREFERRED (should) — the route the person asked to be reached by. At most ONE per entity across
 *                       email, phone and address together, because "reach me by post" is a single
 *                       answer about every channel at once and cannot be recorded in one table's own
 *                       flag.
 *
 * `is_primary` is a third and different thing, which is why it stays where it is: it is a CHANNEL's
 * default row — the address a message goes to when the sender named no address. A person may be
 * permitted three numbers, prefer email, and still have a primary number.
 *
 * None of this is Rule 4.2. A represented party may not be contacted about the subject of ONE
 * matter, which is a fact about that matter and stays matter-scoped and derived from who is on the
 * record there. What lives here is the person's own standing preference, and it applies everywhere.
 */
import type { UserId } from "@magna-carta/identifiers/types";
import type { DirectoryWriteOptions } from "./audit.ts";
import type { ContactRowFields } from "./statements.ts";
import { CONTACT_VERIFICATION_STATUSES, type ContactVerificationStatus } from "./types.ts";

/** Thrown when a verification status outside the catalog is supplied. */
export class InvalidContactVerificationStatusError extends Error {
  readonly code = "invalid-contact-verification-status";
  constructor(status: string) {
    super(
      `directory: not a known contact verification status: ${JSON.stringify(status)} (invalid-contact-verification-status)`,
    );
    this.name = "InvalidContactVerificationStatusError";
  }
}

/** What the person said about this contact point. Every field optional; an omitted one is unchanged. */
export interface ContactPreferenceInput {
  /** May the firm use it. Omitted on a create means yes. */
  readonly permitted?: boolean;
  /** Is it the one route the person asked to be reached by. Omitted on a create means no. */
  readonly preferred?: boolean;
  /** Why it may not be used, or how it should be. */
  readonly note?: string | null;
}

/**
 * What the firm found when it last tried to confirm the contact point.
 *
 * A `failed` status NEVER blocks a send. It is recorded, and it is surfaced to the member who is
 * about to send, and the send proceeds — a bounce or a returned envelope is often temporary, and a
 * platform that refuses on a stale failure teaches its users that its warnings are noise. Who
 * recorded it and when are taken from the write's own clock and actor, never from the caller.
 */
export interface ContactVerificationInput {
  readonly status?: ContactVerificationStatus;
  /** What the failure said, in the words it said it. */
  readonly detail?: string | null;
}

/** The stored columns as they come back from a row read, before they are resolved against an input. */
export interface StoredContactFields {
  readonly contact_permitted: number;
  readonly contact_preferred: number;
  readonly contact_note: string | null;
  readonly verification_status: string;
  readonly verified_at: string | null;
  readonly verified_by: string | null;
  readonly verification_detail: string | null;
}

/** The SELECT list every contact read shares, so the three reads cannot drift apart. */
export const CONTACT_FIELD_SELECT =
  "contact_permitted, contact_preferred, contact_note, verification_status, verified_at, verified_by, verification_detail";

function trimmedNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Fold a caller's preference and verification input over the row's current values.
 *
 * An omitted field keeps what is stored, so a caller updating a phone number does not silently
 * withdraw a permission it never mentioned. `verified_at` and `verified_by` move only when the
 * status itself moves, and they are stamped from the write's clock and actor: a member editing an
 * unrelated field must not have that edit read back later as a confirmation of the value.
 */
export function resolveContactFields(
  input: {
    readonly preference?: ContactPreferenceInput;
    readonly verification?: ContactVerificationInput;
  },
  current: StoredContactFields | null,
  options: DirectoryWriteOptions,
  now: string,
): ContactRowFields {
  const preference = input.preference ?? {};
  const verification = input.verification ?? {};

  const permitted: 0 | 1 =
    preference.permitted === undefined
      ? current === null
        ? 1
        : current.contact_permitted === 1
          ? 1
          : 0
      : preference.permitted
        ? 1
        : 0;
  const preferred: 0 | 1 =
    preference.preferred === undefined
      ? current === null
        ? 0
        : current.contact_preferred === 1
          ? 1
          : 0
      : preference.preferred
        ? 1
        : 0;
  const note =
    preference.note === undefined ? (current?.contact_note ?? null) : trimmedNote(preference.note);

  const currentStatus = current?.verification_status ?? "unverified";
  if (
    verification.status !== undefined &&
    !CONTACT_VERIFICATION_STATUSES.includes(verification.status)
  ) {
    throw new InvalidContactVerificationStatusError(verification.status);
  }
  const status = verification.status ?? currentStatus;
  const statusMoved = status !== currentStatus;

  // A move to unverified is the firm saying it no longer stands behind the earlier finding, so the
  // instant, the member and the detail go with it rather than lingering as evidence of something the
  // record no longer claims.
  const verifiedAt = statusMoved
    ? status === "unverified"
      ? null
      : now
    : (current?.verified_at ?? null);
  const verifiedBy = statusMoved
    ? status === "unverified"
      ? null
      : options.actorUserId
    : ((current?.verified_by ?? null) as UserId | null);
  const detail =
    verification.detail === undefined
      ? statusMoved
        ? null
        : (current?.verification_detail ?? null)
      : trimmedNote(verification.detail);

  return {
    contactPermitted: permitted,
    contactPreferred: preferred,
    contactNote: note,
    verificationStatus: status,
    verifiedAt,
    verifiedBy,
    verificationDetail: detail,
  };
}

/** The resolved preference and verification, as every contact read reports them. */
export interface ContactPointState {
  /** May the firm use this contact point. */
  readonly permitted: boolean;
  /** Is this the one route the person asked to be reached by, across every channel. */
  readonly preferred: boolean;
  readonly note: string | null;
  readonly verificationStatus: ContactVerificationStatus;
  readonly verifiedAt: string | null;
  readonly verificationDetail: string | null;
}

/** Project the stored columns into the shape a read returns. */
export function contactPointStateFromRow(row: StoredContactFields): ContactPointState {
  const status = CONTACT_VERIFICATION_STATUSES.includes(
    row.verification_status as ContactVerificationStatus,
  )
    ? (row.verification_status as ContactVerificationStatus)
    : "unverified";
  return {
    permitted: row.contact_permitted === 1,
    preferred: row.contact_preferred === 1,
    note: row.contact_note,
    verificationStatus: status,
    verifiedAt: row.verified_at,
    verificationDetail: row.verification_detail,
  };
}
