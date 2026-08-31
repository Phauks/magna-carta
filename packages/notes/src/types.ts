// The note primitive's closed vocabularies and its one read cap.

// What a note is, at any moment. Two states and no third: a note is CORRECTED by appending a
// revision (which is not a state change at all) and WITHDRAWN by retraction. There is no draft, no
// archived, and no deleted — a deleted state would be a delete path wearing a vocabulary, and this
// subsystem has none.
export const MATTER_NOTE_STATES = ["active", "retracted"] as const;
export type MatterNoteState = (typeof MATTER_NOTE_STATES)[number];

// A body's ceiling. Generous, because a note is where a lawyer writes down a phone call and nobody
// should be editing their account of one to fit a limit — but bounded, because an unbounded text
// column on a hot read is how one note makes a page unservable. A body over this is refused at the
// write with a named code, never silently truncated: a truncated contemporaneous record is worse
// than a refused one, since the firm believes it has the whole thing.
export const MAX_NOTE_BODY_LENGTH = 20_000;

// A retraction's reason. Short by design — it says why the words came down, not what they were, and
// a reason long enough to restate the note would reintroduce the body on the surface that exists to
// stop showing it.
export const MAX_RETRACTION_REASON_LENGTH = 500;

// The most notes one page may carry, and the most revisions one note's history read may return. The
// history bound is separate and deliberately smaller: a chain that long is a corrupted note or an
// automated writer, not a lawyer correcting a typo, and returning it unbounded would put the whole
// text of every version of one note into a single response.
export const MAX_NOTE_PAGE_SIZE = 50;
export const MAX_NOTE_REVISION_PAGE_SIZE = 100;
