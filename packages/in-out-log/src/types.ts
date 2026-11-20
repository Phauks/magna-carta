// The ceilings and vocabularies of the In/Out Log. Every limit is a refusal at the write, never a
// silent truncation: an entry whose description was cut short is an entry nobody can match to the
// envelope on the desk.

/** Who someone on an entry is: a firm member, a Directory person or organization, or a typed name. */
export type InOutPartyKind = "member" | "entity" | "external";

/** Where an entry is in its short life. Nothing moves back. */
export type InOutEntryStatus = "waiting" | "picked_up" | "moved_to_custodian";

export const IN_OUT_ENTRY_STATUSES: readonly InOutEntryStatus[] = [
  "waiting",
  "picked_up",
  "moved_to_custodian",
];

export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_NAME_LENGTH = 200;
export const MAX_KEPT_AT_LENGTH = 200;
export const MAX_NOTES_LENGTH = 2000;
/** How many people one entry may be To. A desk lists a family, not a mailing list. */
export const MAX_RECIPIENTS = 20;
/** One page of the log. */
export const MAX_ENTRY_PAGE_SIZE = 50;

/** One person as a caller names them. Exactly one of the three identities, matching the kind. */
export interface InOutPartyInput {
  readonly kind: InOutPartyKind;
  readonly userId?: string | null;
  readonly entityId?: string | null;
  readonly name: string;
}

/** One person as the write stores them, after validation. */
export interface InOutParty {
  readonly kind: InOutPartyKind;
  readonly userId: string | null;
  readonly entityId: string | null;
  readonly name: string;
}
