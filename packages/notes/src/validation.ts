import { CIVIL_DATE_PATTERN, isCivilDate } from "@magna-carta/civil-time/civil-date";
import { isResolvableTimeZone } from "@magna-carta/civil-time/time-zone";
import { isWallClockTime } from "@magna-carta/civil-time/wall-clock";
import { MAX_NOTE_BODY_LENGTH, type NoteOccurrence } from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type NoteValidationCode =
  | "note-empty-body"
  | "note-body-too-long"
  // The occurrence shape refusals. Each names the one thing that is wrong rather than a generic
  // "invalid date", because each is fixed by the caller supplying a different field.
  | "note-invalid-date"
  | "note-invalid-time"
  | "note-time-without-date"
  | "note-time-without-zone"
  | "note-unknown-time-zone"
  // A note this reader cannot reach, or one that is not on the matter the caller named. Kept
  // distinct because they are fixed differently, and neither ever reveals which by its message.
  | "note-unknown"
  | "note-matter-mismatch"
  // A file that is not a live file on this note's matter. Refused rather than linked, because a link
  // to another matter's document is a disclosure wearing an association.
  | "note-unknown-file"
  | "note-file-matter-mismatch"
  | "note-too-many-files";

export class NoteValidationError extends Error {
  constructor(
    readonly code: NoteValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "NoteValidationError";
  }
}

function refuse(code: NoteValidationCode, message: string): never {
  throw new NoteValidationError(code, message);
}

// The body as it will be stored. Trimmed at the edges and never in the middle: trailing whitespace
// is an artifact of typing, and the paragraph breaks inside are the writer's.
export function normalizeNoteBody(body: string): string {
  const normalized = body.trim();
  if (normalized.length === 0) refuse("note-empty-body", "a note needs something written in it");
  if (normalized.length > MAX_NOTE_BODY_LENGTH) {
    refuse(
      "note-body-too-long",
      `a note body is at most ${String(MAX_NOTE_BODY_LENGTH)} characters; this one is ${String(normalized.length)}`,
    );
  }
  return normalized;
}

// The occurrence as it will be stored, with the three-way coherence checked once here rather than at
// each call site. Nothing is inferred: a caller that supplies a date and no time gets a date and no
// time, and this never invents a midnight, a zone, or today.
export function normalizeOccurrence(input: {
  readonly occurredOn?: string | null;
  readonly occurredAtTime?: string | null;
  readonly timeZone?: string | null;
}): NoteOccurrence {
  const occurredOn = input.occurredOn ?? null;
  const occurredAtTime = input.occurredAtTime ?? null;
  const timeZone = input.timeZone ?? null;

  if (occurredOn !== null) {
    if (!CIVIL_DATE_PATTERN.test(occurredOn)) {
      refuse(
        "note-invalid-date",
        "the date it happened must be a civil date of the form YYYY-MM-DD",
      );
    }
    // The pattern alone accepts 2026-02-30; isCivilDate also checks the day is on the calendar.
    if (!isCivilDate(occurredOn)) {
      refuse("note-invalid-date", `${occurredOn} is not a date on the calendar`);
    }
  }

  if (occurredAtTime !== null) {
    if (!isWallClockTime(occurredAtTime)) {
      refuse(
        "note-invalid-time",
        "the time it happened must be a wall-clock time of the form HH:MM",
      );
    }
    if (occurredOn === null) {
      refuse(
        "note-time-without-date",
        "an hour with no day is not a moment anybody can place; give the date it happened as well",
      );
    }
    if (timeZone === null) {
      refuse(
        "note-time-without-zone",
        "a wall-clock time needs the zone it is read in, or it is not a time to anybody in another state",
      );
    }
  }

  if (timeZone !== null) {
    if (occurredAtTime === null) {
      refuse(
        "note-time-without-zone",
        "a time zone on a note that names no time says nothing; give the time or drop the zone",
      );
    }
    if (!isResolvableTimeZone(timeZone)) {
      refuse("note-unknown-time-zone", `${timeZone} is not a time zone this platform can resolve`);
    }
  }

  return { occurredOn, occurredAtTime, timeZone };
}
