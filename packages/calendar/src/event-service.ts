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
import {
  assertEventShape,
  assertParticipantShape,
  type EventParticipantInput,
} from "./event-shape.ts";
import {
  CALENDAR_EVENT_CANCELLED_TOPIC,
  CALENDAR_EVENT_RESCHEDULED_TOPIC,
  CALENDAR_EVENT_SCHEDULED_TOPIC,
  type CalendarEventTopicPayload,
} from "./notifications.ts";
import type { MatterEventStatus } from "./types.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";
import { CalendarValidationError } from "./validation.ts";

// Recording what happens in a case. The service validates in memory, composes statements into an
// effect batch, and holds no binding and no clock of its own — the caller supplies the firm-scoped
// database, the real clock, a random source, and the authenticated actor, none of which is ever
// client input.

export interface CalendarServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
  // The visible-matter predicate, on the same required footing every timeline source puts it. A
  // service that reads a row by its own identifier is reaching past the matter that owns it, so it
  // composes the predicate too: an id-addressed read that skipped it would be the hole an
  // information-barrier overlay is built and believed to have closed.
  readonly visibility: VisibleMatterPredicate;
}

export type MatterEventParticipantInput = EventParticipantInput;

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
  /**
   * Where an online setting is JOINED — the meeting's own link, whoever hosts it. A different fact
   * from where it is HELD, which is why it is not squeezed into the location: a deposition can be
   * in a conference room AND on a call, and a firm that wrote "Zoom" where the room goes has lost
   * the room.
   */
  readonly conferenceUrl?: string | null;
  readonly courtReference?: string | null;
  /**
   * The RFC 5545 rule a repeating setting runs on ("FREQ=WEEKLY;BYDAY=TU;COUNT=12"), absent or null
   * for a setting that happens once. ONE ROW carries the whole series: the reads expand it across
   * the window they were asked for. Refused unless this platform could have written it — the same
   * grammar the record form uses, so a rule that saves is a rule that can be edited again.
   */
  readonly recurrenceRule?: string | null;
  /**
   * Where this row is ONE occurrence of a series written as an exception: the series, and the day
   * of it this row replaces. The series' expansion skips that day, so the occurrence is this row.
   */
  readonly recurrenceParentId?: MatterEventId | null;
  readonly recurrenceOccurrenceOn?: string | null;
  readonly participants?: readonly MatterEventParticipantInput[];
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
      conferenceUrl: input.conferenceUrl ?? null,
      courtReference: input.courtReference ?? null,
      recurrenceRule: input.recurrenceRule ?? null,
      recurrenceParentId: input.recurrenceParentId ?? null,
      recurrenceOccurrenceOn: input.recurrenceOccurrenceOn ?? null,
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
  return {
    eventId,
    effect: {
      statements,
      // In the SAME atomic batch as the row it describes, which is the whole difference between a
      // durable announcement and a best-effort one: a batch that rolls back leaves no message, and a
      // message that exists is proof the event was recorded. This package still learns nothing about
      // delivery — it publishes a name and stops.
      outboxMessages: [
        {
          topic: CALENDAR_EVENT_SCHEDULED_TOPIC,
          payload: {
            matterEventId: eventId,
            matterId: input.matterId,
          } satisfies CalendarEventTopicPayload,
        },
      ],
    },
  };
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
  /**
   * Where an online setting is JOINED — the meeting's own link, whoever hosts it. A different fact
   * from where it is HELD, which is why it is not squeezed into the location: a deposition can be
   * in a conference room AND on a call, and a firm that wrote "Zoom" where the room goes has lost
   * the room.
   */
  readonly conferenceUrl?: string | null;
  readonly courtReference?: string | null;
  /**
   * The repeat rule. Supplying it changes the whole series' rule; supplying null makes a repeating
   * setting happen once; omitting it leaves the rule alone, as every other field here works.
   */
  readonly recurrenceRule?: string | null;
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
  const existing = await readMatterEvent(database, eventId, options.visibility);
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
    conferenceUrl:
      patch.conferenceUrl === undefined ? existing.conference_url : patch.conferenceUrl,
    courtReference:
      patch.courtReference === undefined ? existing.court_reference : patch.courtReference,
    recurrenceRule:
      patch.recurrenceRule === undefined ? existing.recurrence_rule : patch.recurrenceRule,
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
  return {
    effect: {
      statements,
      // Only when the setting actually MOVED. A title fix, a room change, or a participant edit is
      // not a reschedule, and announcing one for a typo correction is how a team learns to ignore
      // the announcements. The comparison is over exactly the fields that say when the thing
      // happens; `merged` has already resolved every absent patch field to the existing value, so a
      // patch that names a date and repeats it raises nothing.
      outboxMessages: eventTimingMoved(existing, merged)
        ? [
            {
              topic: CALENDAR_EVENT_RESCHEDULED_TOPIC,
              payload: {
                matterEventId: eventId,
                matterId: existing.matter_id,
              } satisfies CalendarEventTopicPayload,
            },
          ]
        : [],
    },
  };
}

// When a setting happens, as the five columns that answer it. Compared as stored: dates and times
// are civil text and the zone is an identifier, so equality is byte equality and there is no
// arithmetic here to get wrong.
function eventTimingMoved(
  existing: Pick<
    MatterEventRow,
    "starts_on" | "starts_at_time" | "ends_on" | "ends_at_time" | "time_zone"
  >,
  merged: {
    readonly startsOn: string;
    readonly startsAtTime: string | null;
    readonly endsOn: string | null;
    readonly endsAtTime: string | null;
    readonly timeZone: string;
  },
): boolean {
  return (
    existing.starts_on !== merged.startsOn ||
    existing.starts_at_time !== merged.startsAtTime ||
    existing.ends_on !== merged.endsOn ||
    existing.ends_at_time !== merged.endsAtTime ||
    existing.time_zone !== merged.timeZone
  );
}

export async function cancelMatterEvent(
  database: SqlDatabase,
  eventId: MatterEventId,
  options: CalendarServiceOptions,
  statusReason: string | null = null,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterEvent(database, eventId, options.visibility);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        cancelMatterEventStatement(database, eventId, now, statusReason),
        domainAuditStatement(database, {
          event: "calendar.event.cancelled",
          subjectId: eventId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: existing.matter_id },
        }),
      ],
      outboxMessages: [
        {
          topic: CALENDAR_EVENT_CANCELLED_TOPIC,
          payload: {
            matterEventId: eventId,
            matterId: existing.matter_id,
          } satisfies CalendarEventTopicPayload,
        },
      ],
    },
  };
}

export type { MatterEventRow };
