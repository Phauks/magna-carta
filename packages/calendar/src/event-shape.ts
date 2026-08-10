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
