/*
 * What a modal's subtitle line is allowed to say. Everything here answers ONE question — what is
 * being acted on — and nothing here can answer a different one, which is the whole point of the
 * shape: the slot was typed `string` before, and a slot typed `string` accepts a paragraph about
 * what a subsystem is for.
 *
 * It is the sibling of ../entity-identity's contract and draws the same line that one draws. An
 * EntityIdentity names a PERSON OR ORGANIZATION from somewhere else on a work surface; this names
 * the RECORD a panel is acting on, by the number somebody would read back down a telephone. Neither
 * infers anything about the other.
 */

/**
 * How firmly a record holds the number it is shown under. The three are the domain's own, and the
 * distinction between the last two is load-bearing rather than a shade of wording.
 *
 * - `drawn` is the record's permanent number. A matter number, an invoice number, an entry number.
 * - `tentative` is a number the record really carries and which a permanent one may later join
 *   rather than replace. A consultation draws one on graduating from intake, keeps it after the
 *   matter opens, and a document filed under it still resolves —
 *   `packages/matters/src/numbering/consultation-scheme.ts` is where that is decided.
 * - `preview` is not drawn at all: it is what the NEXT record would take, shown while the reader is
 *   still filling the panel in, and it says so rather than implying a reservation. Somebody on the
 *   telephone needs something to write on a slip, and the save is too late for the sentence they are
 *   in the middle of.
 *
 * Closed on purpose: a fourth standing is a reviewed change to this file, not a call site's
 * improvisation. What each one renders is resolved in ./record-reference-model.ts.
 */
export type ReferenceStanding = "drawn" | "tentative" | "preview";

/** A record, by the number a person quotes out loud. */
export interface RecordReference {
  /**
   * The record kind as a reader says it — "Matter", "Bill", "Call", "Packet". A caller's own
   * word: the design system serves every kind and names none of them, the same rule the modal
   * shells hold to.
   */
  readonly kind: string;
  /**
   * The number itself, as the record carries it. Null where there is not one to show — which the
   * standing then tells the reader how to take: a `preview` with no number says one is drawn on
   * save, and any other standing with no number says only what kind of record this is.
   */
  readonly number: string | null;
  /** Defaults to `drawn`. */
  readonly standing?: ReferenceStanding;
}

/**
 * The subtitle's whole content: what is being acted on, and the few facts about it worth stating
 * beside its number.
 *
 * A FACT IS NOT A SENTENCE. "this matter still owes $4,120.00" is a fact about the subject; "A
 * conflicts check searches the firm's own record and writes what it searched into the log" is a
 * paragraph about a subsystem, and the owner struck exactly that one on 2026-09-08. What the panel
 * DOES is the heading's job, and saying it twice invites the two to disagree. The scan in
 * tooling/lint-modal-headers reads these for sentence shape.
 */
export interface RecordSubject {
  /** What is being acted on, by its number. Absent only where the subject genuinely has none. */
  readonly reference?: RecordReference;
  /** Short facts about that subject. Never a description of the act. */
  readonly facts?: readonly string[];
}
