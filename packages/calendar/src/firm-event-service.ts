import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmEventId, LocationId, MatterEventTypeId } from "@magna-carta/identifiers/types";
import type { CalendarServiceOptions } from "./event-service.ts";
import {
  assertEventShape,
  assertParticipantShape,
  type EventParticipantInput,
} from "./event-shape.ts";
import { readMatterEventType } from "./event-type-statements.ts";
import {
  cancelFirmEventStatement,
  deleteFirmEventParticipantsStatement,
  insertFirmEventParticipantStatement,
  insertFirmEventStatement,
  readFirmEvent,
  updateFirmEventStatement,
  type FirmEventRow,
} from "./firm-event-statements.ts";
import type { FirmEventAudience, FirmEventStatus } from "./types.ts";
import { CalendarValidationError } from "./validation.ts";

// Recording what the firm schedules for itself. The same discipline as the matter-event service —
// validate in memory, compose statements into an effect batch, hold no binding and no clock — with
// the matter-event SHAPES parameterized over this table rather than copied: the shape asserts live
// in event-shape.ts and serve both scopes.
//
// The service takes the same CalendarServiceOptions the matter-event service takes, visibility
// predicate included, even though no firm-event read composes it: the options object is the route
// layer's one wiring shape, and a firm event's reads declare their firm anchor at the source
// registry instead (see firm-event-statements.ts).

export interface CreateFirmEventInput {
  readonly eventTypeId?: MatterEventTypeId | null;
  readonly title: string;
  readonly description?: string | null;
  readonly status?: FirmEventStatus;
  readonly startsOn: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  readonly timeZone: string;
  readonly audience?: FirmEventAudience;
  readonly locationId?: LocationId | null;
  readonly locationText?: string | null;
  /**
   * Where an online setting is JOINED — the meeting's own link, whoever hosts it. A different fact
   * from where it is HELD, which is why it is not squeezed into the location: a deposition can be
   * in a conference room AND on a call, and a firm that wrote "Zoom" where the room goes has lost
   * the room.
   */
  readonly conferenceUrl?: string | null;
  /**
   * The RFC 5545 rule a repeating event runs on, absent or null for one that happens once. One row
   * carries the series; the reads expand it across the window they were asked for.
   */
  readonly recurrenceRule?: string | null;
  /**
   * Where this row is ONE occurrence of a series written as an exception: the series, and the day
   * of it this row replaces. The series' expansion skips that day, so the occurrence is this row.
   */
  readonly recurrenceParentId?: FirmEventId | null;
  readonly recurrenceOccurrenceOn?: string | null;
  readonly participants?: readonly EventParticipantInput[];
}

function participantStatements(
  database: SqlDatabase,
  firmEventId: FirmEventId,
  participants: readonly EventParticipantInput[],
  options: CalendarServiceOptions,
): SqlStatement[] {
  const now = options.clock.now();
  return participants.map((participant) => {
    assertParticipantShape(participant);
    return insertFirmEventParticipantStatement(database, {
      id: newIdentifier("firmEventParticipant", options.randomSource),
      firmEventId,
      participantKind: participant.participantKind,
      memberUserId: participant.memberUserId ?? null,
      entityId: participant.entityId ?? null,
      participantName: participant.participantName ?? null,
      role: participant.role ?? null,
      now,
    });
  });
}

// The catalog is shared between the two scopes and its `category` column is what separates them, so
// a firm event typed "Hearing" is a data-entry error the read surfaces would then have to explain.
// Refused here rather than by the table: the column is a plain foreign key, and narrowing it in SQL
// would mean rebuilding a settled table for a rule composition can hold. A type nothing in the
// catalog matches is left to the foreign key, which already refuses it.
async function assertFirmScopedEventType(
  database: SqlDatabase,
  eventTypeId: MatterEventTypeId | null,
): Promise<void> {
  if (eventTypeId === null) return;
  const eventType = await readMatterEventType(database, eventTypeId);
  if (eventType !== undefined && eventType.category !== "firm") {
    throw new CalendarValidationError(
      "calendar-event-type-category-mismatch",
      `"${eventType.name}" is a ${eventType.category} event type; a firm event takes a firm-category type`,
    );
  }
}

export async function createFirmEvent(
  database: SqlDatabase,
  input: CreateFirmEventInput,
  options: CalendarServiceOptions,
): Promise<{ firmEventId: FirmEventId; effect: EffectWrite }> {
  assertEventShape(input);
  await assertFirmScopedEventType(database, input.eventTypeId ?? null);
  const now = options.clock.now();
  const firmEventId = newIdentifier("firmEvent", options.randomSource);
  const statements: SqlStatement[] = [
    insertFirmEventStatement(database, {
      id: firmEventId,
      eventTypeId: input.eventTypeId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "scheduled",
      startsOn: input.startsOn,
      startsAtTime: input.startsAtTime ?? null,
      endsOn: input.endsOn ?? null,
      endsAtTime: input.endsAtTime ?? null,
      timeZone: input.timeZone,
      audience: input.audience ?? "participants",
      locationId: input.locationId ?? null,
      locationText: input.locationText ?? null,
      conferenceUrl: input.conferenceUrl ?? null,
      recurrenceRule: input.recurrenceRule ?? null,
      recurrenceParentId: input.recurrenceParentId ?? null,
      recurrenceOccurrenceOn: input.recurrenceOccurrenceOn ?? null,
      recordedAt: now,
      recordedBy: options.actorUserId,
      now,
    }),
    ...participantStatements(database, firmEventId, input.participants ?? [], options),
    // Identifiers only in the metadata — a firm event's title is free text like any other.
    domainAuditStatement(database, {
      event: "calendar.firmEvent.created",
      subjectId: firmEventId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {},
    }),
  ];
  return { firmEventId, effect: { statements, outboxMessages: [] } };
}

export interface UpdateFirmEventInput {
  readonly eventTypeId?: MatterEventTypeId | null;
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: FirmEventStatus;
  readonly startsOn?: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  readonly timeZone?: string;
  // Audience transitions are unrestricted: promoting a meeting to all-members or narrowing a
  // firm-wide entry back to its list is an ordinary edit.
  readonly audience?: FirmEventAudience;
  readonly locationId?: LocationId | null;
  readonly locationText?: string | null;
  readonly conferenceUrl?: string | null;
  /**
   * The repeat rule. Supplying it changes the series' rule; null makes a repeating event happen
   * once; omitting it leaves the rule alone.
   */
  readonly recurrenceRule?: string | null;
  // Supplying this replaces the whole participant set; omitting it leaves it alone.
  readonly participants?: readonly EventParticipantInput[];
}

// Edit-in-place throughout. A moved staff meeting is not procedural history — nobody litigates the
// all-hands — so firm events keep the mutable-event semantics and the continuance machinery binds
// matter events only (see continuance-service.ts).
export async function updateFirmEvent(
  database: SqlDatabase,
  firmEventId: FirmEventId,
  patch: UpdateFirmEventInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readFirmEvent(database, firmEventId);
  if (existing === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-firm-event",
      "no such firm event in this firm",
    );
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
    audience: patch.audience ?? existing.audience,
    locationId: patch.locationId === undefined ? existing.location_id : patch.locationId,
    locationText: patch.locationText === undefined ? existing.location_text : patch.locationText,
    conferenceUrl:
      patch.conferenceUrl === undefined ? existing.conference_url : patch.conferenceUrl,
    recurrenceRule:
      patch.recurrenceRule === undefined ? existing.recurrence_rule : patch.recurrenceRule,
  };
  assertEventShape(merged);
  // Only what the patch actually names: an edit to the title never re-litigates a type already on
  // the row.
  if (patch.eventTypeId !== undefined) {
    await assertFirmScopedEventType(database, patch.eventTypeId);
  }
  const now = options.clock.now();
  const statements: SqlStatement[] = [updateFirmEventStatement(database, firmEventId, merged, now)];
  if (patch.participants !== undefined) {
    statements.push(deleteFirmEventParticipantsStatement(database, firmEventId));
    statements.push(...participantStatements(database, firmEventId, patch.participants, options));
  }
  statements.push(
    domainAuditStatement(database, {
      event: "calendar.firmEvent.updated",
      subjectId: firmEventId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      // WHICH dates moved and nothing about what the event is.
      metadata: { startsOnBefore: existing.starts_on, startsOnAfter: merged.startsOn },
    }),
  );
  return { effect: { statements, outboxMessages: [] } };
}

export async function cancelFirmEvent(
  database: SqlDatabase,
  firmEventId: FirmEventId,
  options: CalendarServiceOptions,
  statusReason: string | null = null,
): Promise<{ effect: EffectWrite }> {
  const existing = await readFirmEvent(database, firmEventId);
  if (existing === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-firm-event",
      "no such firm event in this firm",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // Cancelling releases the event's bookings by derivation — a booking blocks its resource
        // only while its event is live, so there is no second write here and nothing to forget.
        cancelFirmEventStatement(database, firmEventId, now, statusReason),
        domainAuditStatement(database, {
          event: "calendar.firmEvent.cancelled",
          subjectId: firmEventId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {},
        }),
      ],
      outboxMessages: [],
    },
  };
}

export type { FirmEventRow };
