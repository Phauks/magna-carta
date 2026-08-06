import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  MatterEventId,
  MatterEventTypeId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  cancelMatterEventStatement,
  deleteMatterEventParticipantsStatement,
  insertMatterEventParticipantStatement,
  insertMatterEventStatement,
  readMatterEvent,
  updateMatterEventStatement,
  type MatterEventRow,
} from "./event-statements.ts";
import type { MatterEventParticipantKind, MatterEventStatus } from "./types.ts";
import {
  CalendarValidationError,
  assertCivilDate,
  assertNonEmptyTitle,
  assertTimeZone,
  assertWallClockTime,
} from "./validation.ts";

// Recording what happens in a case. The service validates in memory, composes statements into an
// effect batch, and holds no binding and no clock of its own — the caller supplies the firm-scoped
// database, the real clock, a random source, and the authenticated actor, none of which is ever
// client input.

export interface CalendarServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export interface MatterEventParticipantInput {
  readonly participantKind: MatterEventParticipantKind;
  readonly memberUserId?: UserId | null;
  readonly entityId?: string | null;
  readonly participantName?: string | null;
  readonly role?: string | null;
}

export interface CreateMatterEventInput {
  readonly matterId: MatterId;
  readonly eventTypeId?: MatterEventTypeId | null;
  readonly title: string;
  readonly description?: string | null;
  readonly status?: MatterEventStatus;
  readonly startsOn: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  readonly timeZone: string;
  readonly locationText?: string | null;
  readonly courtReference?: string | null;
  readonly participants?: readonly MatterEventParticipantInput[];
}

// The shape rules, stated once and applied on both the create and the update path. The schema
// carries the same checks; these exist so a caller gets a named refusal it can act on instead of a
// database abort it cannot read.
function assertEventShape(input: {
  title: string;
  startsOn: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  timeZone: string;
}): void {
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
  // Validated at the WRITE and never at the read: a row whose zone no runtime can resolve is a
  // hearing nobody can display and nobody can correct without a migration.
  assertTimeZone(input.timeZone);
}

function assertParticipantShape(participant: MatterEventParticipantInput): void {
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

function participantStatements(
  database: SqlDatabase,
  eventId: MatterEventId,
  participants: readonly MatterEventParticipantInput[],
  options: CalendarServiceOptions,
): SqlStatement[] {
  const now = options.clock.now();
  return participants.map((participant) => {
    assertParticipantShape(participant);
    return insertMatterEventParticipantStatement(database, {
      id: newIdentifier("matterEventParticipant", options.randomSource),
      eventId,
      participantKind: participant.participantKind,
      memberUserId: participant.memberUserId ?? null,
      entityId: participant.entityId ?? null,
      participantName: participant.participantName ?? null,
      role: participant.role ?? null,
      now,
    });
  });
}

export function createMatterEvent(
  database: SqlDatabase,
  input: CreateMatterEventInput,
  options: CalendarServiceOptions,
): { eventId: MatterEventId; effect: EffectWrite } {
  assertEventShape(input);
  const now = options.clock.now();
  const eventId = newIdentifier("matterEvent", options.randomSource);
  const statements: SqlStatement[] = [
    insertMatterEventStatement(database, {
      id: eventId,
      matterId: input.matterId,
      eventTypeId: input.eventTypeId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "scheduled",
      startsOn: input.startsOn,
      startsAtTime: input.startsAtTime ?? null,
      endsOn: input.endsOn ?? null,
      endsAtTime: input.endsAtTime ?? null,
      timeZone: input.timeZone,
      locationText: input.locationText ?? null,
      courtReference: input.courtReference ?? null,
      // When the person asserted it, as against when it happens. Both are recorded because they
      // diverge routinely.
      recordedAt: now,
      recordedBy: options.actorUserId,
      now,
    }),
    ...participantStatements(database, eventId, input.participants ?? [], options),
    // Identifiers only in the metadata. Never a title, a description, a court reference, or a
    // participant's name — the audit log is not a second place a case's content lives.
    domainAuditStatement(database, {
      event: "calendar.event.created",
      subjectId: eventId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { matterId: input.matterId },
    }),
  ];
  return { eventId, effect: { statements, outboxMessages: [] } };
}

export interface UpdateMatterEventInput {
  readonly eventTypeId?: MatterEventTypeId | null;
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: MatterEventStatus;
  readonly startsOn?: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  readonly timeZone?: string;
  readonly locationText?: string | null;
  readonly courtReference?: string | null;
  // Supplying this replaces the whole participant set; omitting it leaves it alone.
  readonly participants?: readonly MatterEventParticipantInput[];
}

// An event is edited in place, and a continued hearing is exactly that: the same hearing, a new
// date, one row, and the audit entry beside it carrying the move. The alternative — a second row
// linked to the first — puts two hearings on the calendar and makes every consumer responsible for
// hiding one, which is the kind of rule that gets implemented three times and agreed on twice.
export async function updateMatterEvent(
  database: SqlDatabase,
  eventId: MatterEventId,
  patch: UpdateMatterEventInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterEvent(database, eventId);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
  }
  const merged = {
    eventTypeId: patch.eventTypeId === undefined ? existing.event_type_id : patch.eventTypeId,
    title: patch.title ?? existing.title,
    description: patch.description === undefined ? existing.description : patch.description,
    status: patch.status ?? existing.status,
    startsOn: patch.startsOn ?? existing.starts_on,
    startsAtTime: patch.startsAtTime === undefined ? existing.starts_at_time : patch.startsAtTime,
    endsOn: patch.endsOn === undefined ? existing.ends_on : patch.endsOn,
    endsAtTime: patch.endsAtTime === undefined ? existing.ends_at_time : patch.endsAtTime,
    timeZone: patch.timeZone ?? existing.time_zone,
    locationText: patch.locationText === undefined ? existing.location_text : patch.locationText,
    courtReference:
      patch.courtReference === undefined ? existing.court_reference : patch.courtReference,
  };
  assertEventShape(merged);
  const now = options.clock.now();
  const statements: SqlStatement[] = [updateMatterEventStatement(database, eventId, merged, now)];
  if (patch.participants !== undefined) {
    statements.push(deleteMatterEventParticipantsStatement(database, eventId));
    statements.push(...participantStatements(database, eventId, patch.participants, options));
  }
  // Exactly one audit row per update, carrying WHICH dates moved and nothing about what the event
  // is — a rescheduling is the change a person goes looking for six months later.
  statements.push(
    domainAuditStatement(database, {
      event: "calendar.event.updated",
      subjectId: eventId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {
        matterId: existing.matter_id,
        startsOnBefore: existing.starts_on,
        startsOnAfter: merged.startsOn,
      },
    }),
  );
  return { effect: { statements, outboxMessages: [] } };
}

export async function cancelMatterEvent(
  database: SqlDatabase,
  eventId: MatterEventId,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterEvent(database, eventId);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        cancelMatterEventStatement(database, eventId, now),
        domainAuditStatement(database, {
          event: "calendar.event.cancelled",
          subjectId: eventId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: existing.matter_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export type { MatterEventRow };
