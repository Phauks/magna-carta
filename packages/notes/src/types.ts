// The note's vocabularies, ceilings and caps.

// A body's ceiling. Generous, because a note is where a lawyer writes down a phone call and nobody
// should be editing their account of one to fit a limit — but bounded, because an unbounded text
// column on a hot read is how one note makes a page unservable. A body over this is refused at the
// write with a named code, never silently truncated: a truncated record is worse than a refused one,
// since the firm believes it has the whole thing.
export const MAX_NOTE_BODY_LENGTH = 20_000;

// The most notes one page may carry, and the most files one note may have on it. The second is a
// belt rather than a rule anybody will meet: a note about a document review names the files it
// covered, not the matter's whole file list.
export const MAX_NOTE_PAGE_SIZE = 50;
export const MAX_NOTE_DOCUMENT_COUNT = 50;

// The civil-date and wall-clock shapes are @magna-carta/civil-time's, not restated here. Import
// them from there: a local copy is a shape that can be loosened on its own.

// What a note says about when the thing it describes happened. All three are optional together: a
// standing instruction ("do not call this client before 10am") records no moment at all.
//
// The shape rules, held by the schema as well as here: a time needs a date, because an hour with no
// day is not a moment anybody can place; and a wall-clock time needs a zone, because "3pm" on a
// record read in another state is not a time. A zone without a time says nothing, so it is refused
// in that direction too.
export interface NoteOccurrence {
  readonly occurredOn: string | null;
  readonly occurredAtTime: string | null;
  readonly timeZone: string | null;
}
