import { parseRecurrence } from "@magna-carta/civil-time/recurrence";
import type { UserId } from "@magna-carta/identifiers/types";
import type { MatterEventParticipantKind } from "./types.ts";
import {
  CalendarValidationError,
  assertCivilDate,
  assertNonEmptyTitle,
  assertTimeZone,
  assertWallClockTime,
} from "./validation.ts";

// The event shape rules, stated once and shared by the matter-event and firm-event services — the
// two tables are the two answers to "whose calendar is this on", but a date is a date and an end
// before a start is wrong on both. The schema carries the same checks; these exist so a caller gets
// a named refusal it can act on instead of a database abort it cannot read.

export interface EventShapeInput {
  readonly title: string;
  readonly startsOn: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  readonly timeZone: string;
  /** The RFC 5545 rule a repeating setting runs on, or null/absent for a one-off. */
  readonly recurrenceRule?: string | null;
}

export function assertEventShape(input: EventShapeInput): void {
  assertNonEmptyTitle(input.title);
  assertCivilDate(input.startsOn, "startsOn");
  assertWallClockTime(input.startsAtTime, "startsAtTime");
  if (input.endsOn !== null && input.endsOn !== undefined) {
    assertCivilDate(input.endsOn, "endsOn");
    if (input.endsOn < input.startsOn) {
      throw new CalendarValidationError(
        "calendar-invalid-range",
        "an event cannot end before it starts",
      );
    }
  }
  assertWallClockTime(input.endsAtTime, "endsAtTime");
  if (
    input.endsAtTime !== null &&
    input.endsAtTime !== undefined &&
    (input.startsAtTime === null || input.startsAtTime === undefined)
  ) {
    throw new CalendarValidationError(
      "calendar-invalid-range",
      "an end time needs a start time: an all-day event that ends at half past four is not a shape anybody can act on",
    );
  }
  // Validated at the WRITE and never at the read: a row whose zone no runtime can resolve is an
  // event nobody can display and nobody can correct without a migration.
  assertTimeZone(input.timeZone);
  assertRecurrenceRule(input.recurrenceRule);
}

/**
 * The rule, refused unless this platform could have written it.
 *
 * READ WITH THE SAME GRAMMAR THE FORM WRITES — `@magna-carta/civil-time/recurrence`, which both
 * sides import — so a rule the record form can produce is a rule this accepts, and a rule it cannot
 * present is a rule this refuses. Two readings of "valid rule" would disagree the first time either
 * was corrected, and the disagreement would show up as a setting that saved and then could not be
 * edited.
 *
 * Refused at the WRITE, for the reason the zone is: a stored rule nothing can parse is a series
 * nobody can see the end of and nobody can correct without a migration.
 */
function assertRecurrenceRule(rule: string | null | undefined): void {
  if (rule === null || rule === undefined) return;
  if (parseRecurrence(rule) === null) {
    throw new CalendarValidationError(
      "calendar-invalid-recurrence",
      "the repeat rule is not one this platform can read back: it is stored as an RFC 5545 RRULE " +
        "and only the rules the record form offers are accepted",
    );
  }
}

// The three participant shapes both event scopes share: a firm member, a Directory entity, or
// somebody external to both. The kind names which column carries the participant.
export interface EventParticipantInput {
  readonly participantKind: MatterEventParticipantKind;
  readonly memberUserId?: UserId | null;
  readonly entityId?: string | null;
  readonly participantName?: string | null;
  readonly role?: string | null;
}

export function assertParticipantShape(participant: EventParticipantInput): void {
  const named =
    (participant.participantKind === "member" &&
      participant.memberUserId !== null &&
      participant.memberUserId !== undefined) ||
    (participant.participantKind === "entity" &&
      participant.entityId !== null &&
      participant.entityId !== undefined) ||
    (participant.participantKind === "external" &&
      participant.participantName !== null &&
      participant.participantName !== undefined &&
      participant.participantName.trim().length > 0);
  if (!named) {
    throw new CalendarValidationError(
      "calendar-invalid-participant",
      `a ${participant.participantKind} participant must name one: a member, a directory entity, or a name`,
    );
  }
}
