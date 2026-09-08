import type { DispositionKind } from "./types.ts";

// The waiver's own record — what a firm actually has to produce when a waiver is questioned.
//
// The rules a firm operates under do not ask whether a lawyer believed a waiver was given. They ask
// for the client's informed consent CONFIRMED IN WRITING, and they ask the firm to hand that
// confirmation over. A free-text sentence is not a confirmation, so recording a waiver as a kind and
// a sentence recorded a belief rather than a fact. These four facts are the record: who consented,
// whether the consent was confirmed in writing, the filed document that evidences the confirmation,
// and when the waiver was given.
//
// TWO FACTS THAT LOOK LIKE ONE AND ARE NOT. `confirmedInWriting` is stored in its own right rather
// than derived from `documentFileId` being present. Consent confirmed in a writing the firm has not
// filed here, and a document filed against consent nobody confirmed, are different states of the
// world; a boolean computed from the file reference could not tell them apart, and the one it would
// silently report is the flattering one.
//
// WHEN IT WAS GIVEN IS NOT WHEN IT WAS RECORDED. `givenOn` is a civil date supplied by the reviewer;
// the row's `created_at` is when the platform wrote it down. A waiver given on Tuesday and recorded
// on Friday has to be able to say both, because the interval is exactly what a reviewer gets asked
// about.

/** The waiver as a reviewer supplies it. Required in full on a `waiver_obtained` disposition. */
export interface WaiverInput {
  /**
   * The Directory entity that consented — the same kind of handle the hit itself matched on, never
   * a typed-in name. A waiver whose giver cannot be looked up in the firm's own records is the
   * free-text sentence this whole record replaces.
   */
  readonly givenByEntityId: string;
  /** Whether the consent was confirmed in writing. Stated, never inferred from the document. */
  readonly confirmedInWriting: boolean;
  /**
   * The filed document evidencing the confirmation, where the firm has filed it. Null is a real and
   * recordable state: the writing may not have arrived yet, or may not have been filed yet, and a
   * platform that refused the row would simply not be told about the waiver at all.
   */
  readonly documentFileId: string | null;
  /** The civil date the waiver was given, `YYYY-MM-DD`. */
  readonly givenOn: string;
}

/**
 * The waiver as the log holds it. Every field is nullable because every field can genuinely be
 * absent: on the other three disposition kinds, where a waiver record is refused outright, and on a
 * `waiver_obtained` row written before these columns existed — which reads as the row not saying,
 * never as a waiver given by nobody.
 */
export interface StoredWaiver {
  readonly givenByEntityId: string | null;
  readonly confirmedInWriting: boolean | null;
  readonly documentFileId: string | null;
  readonly givenOn: string | null;
}

/**
 * What a recorded waiver is missing, as a closed catalogue.
 *
 * These are facts about the PLATFORM'S OWN RECORD — what it holds and what it does not — never facts
 * about the matter or grades of the reviewer's judgement. That is the only kind of assertion this
 * subsystem makes, and it is why an incomplete waiver may be stated out loud on every surface: the
 * platform is saying what it cannot produce, not second-guessing whoever recorded it.
 *
 * A waiver with any shortfall at all is incomplete. The one failure this record exists to prevent is
 * an unevidenced waiver that reads exactly like an evidenced one.
 */
export const WAIVER_SHORTFALLS = [
  "consenting-party-unrecorded",
  "consent-not-confirmed-in-writing",
  "confirmation-not-filed",
  "date-given-unrecorded",
] as const;
export type WaiverShortfall = (typeof WAIVER_SHORTFALLS)[number];

/*
 * A civil date, and nothing that merely looks like one — the column's own shape CHECK mirrored in
 * code. Both halves (the shape, and the day actually being on the calendar: a shape check alone
 * admits 2026-02-31 and 2026-13-01) are @magna-carta/civil-time's, so this is the one function under
 * this package's own name rather than a fourth implementation of it.
 */
export { isCivilDate } from "@magna-carta/civil-time/civil-date";

/**
 * What one disposition's waiver record is missing, in catalogue order.
 *
 * Empty for every kind other than `waiver_obtained` — those kinds carry no waiver record and are not
 * incomplete for lacking one — and empty for a waiver whose record is whole.
 */
export function waiverShortfalls(
  kind: DispositionKind,
  waiver: StoredWaiver | null,
): readonly WaiverShortfall[] {
  if (kind !== "waiver_obtained") return [];
  const shortfalls: WaiverShortfall[] = [];
  if (waiver === null || waiver.givenByEntityId === null) {
    shortfalls.push("consenting-party-unrecorded");
  }
  // Null and false are different sentences — "the row does not say" and "the reviewer said it was
  // not" — and both leave the firm without the thing it would be asked to produce, so both count.
  if (waiver === null || waiver.confirmedInWriting !== true) {
    shortfalls.push("consent-not-confirmed-in-writing");
  }
  if (waiver === null || waiver.documentFileId === null) {
    shortfalls.push("confirmation-not-filed");
  }
  if (waiver === null || waiver.givenOn === null) {
    shortfalls.push("date-given-unrecorded");
  }
  return shortfalls;
}

/**
 * Whether this disposition's record is short of what a firm would be asked to produce.
 *
 * Deliberately not a field on the row and never stored: it is computed from the row on every read,
 * the way the matter posture's scope shortfall is, so filing the confirmation later changes what
 * every surface says with no sweep and no write. What "later" means here is a SECOND disposition
 * row — the table is append-only, so a waiver whose evidence arrives afterwards is recorded as a new
 * act, and the interval between the two rows is itself part of the record.
 */
export function waiverIsIncomplete(kind: DispositionKind, waiver: StoredWaiver | null): boolean {
  return waiverShortfalls(kind, waiver).length > 0;
}
