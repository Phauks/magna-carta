/*
 * RecordReference — a record named by the number somebody quotes out loud, and the subtitle line a
 * modal states it on.
 *
 * Exported as the subject component plus its model rather than a namespace of parts: there is
 * nothing to compose. A caller hands the shell a subject and the line reads the same in every panel,
 * which is the whole reason it exists — a reader who has learned where a panel names its record has
 * learned it everywhere.
 */
export { default as RecordSubjectLine } from "./record-subject.svelte";
export type { RecordReference, RecordSubject, ReferenceStanding } from "./types.ts";
export { DraftNumber, DRAFT_NUMBER_RENEWAL_MILLISECONDS } from "./draft-number.svelte.ts";
export type { DraftNumberKeeper, HeldDraftNumber } from "./draft-number.svelte.ts";
export {
  DRAFT_NUMBER_DESCRIPTION,
  renderReference,
  subjectIsEmpty,
  SUBJECT_SEPARATOR,
} from "./record-reference-model.ts";
export type { RenderedReference } from "./record-reference-model.ts";
