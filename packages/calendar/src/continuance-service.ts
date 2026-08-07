import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterEventId } from "@magna-carta/identifiers/types";
import { readBookingsForEvent, type LiveBookingRow } from "./booking-statements.ts";
import { readOpenDeadlinesByTriggerEvent, type MatterDeadlineRow } from "./deadline-statements.ts";
import type { CalendarServiceOptions } from "./event-service.ts";
import { assertEventShape } from "./event-shape.ts";
import {
  cancelMatterEventStatement,
  insertMatterEventParticipantStatement,
  insertMatterEventStatement,
  readMatterEvent,
  readMatterEventParticipants,
  selectMatterEventChainNodesStatement,
  type MatterEventRow,
} from "./event-statements.ts";
import {
  insertCalendarEventLinkStatement,
  readContinuancePredecessorLink,
  readContinuanceSuccessorLink,
  type CalendarEventLinkRow,
} from "./link-statements.ts";
import { MAX_CONTINUANCE_CHAIN_DEPTH } from "./types.ts";
import { CalendarValidationError } from "./validation.ts";

// The honest continuance. A correction is an edit — the row misdescribed reality, and slice 1's
// mutable-event rule stands for exactly that case. A continuance is a REAL-WORLD RESCHEDULE: the
// court vacated one setting and made another, both of which happened, and a record that shows only
// the new one has falsified the old. So the operation produces the old row untouched in every
// historical column (status, status_reason, and updated_at are the only bytes that move), a new row
// carrying the setting as it now stands, and ONE continuance link, new setting pointing at old,
// held to a chain by the schema's partial unique indexes.
//
// NOTHING HERE COMPUTES A DATE. The new setting's date is the caller's — the court's order, typed
// by a person. The open deadlines whose trigger names the vacated setting are LOOKED UP and
// reported, never moved: what a continuance does to a stipulated briefing schedule is a legal
// judgement, and a computed answer would be trusted precisely because it was computed.

export interface ContinueMatterEventInput {
  // The new setting, as the court made it.
  readonly startsOn: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  // Omitted means the setting stayed in its zone; supplied means the court moved.
  readonly timeZone?: string;
  readonly locationText?: string | null;
  readonly courtReference?: string | null;
  // Why the old setting is no longer happening ("Continued on defendant's motion").
  readonly statusReason?: string | null;
}

export interface ContinueMatterEventResult {
  readonly newEventId: MatterEventId;
  readonly oldEventId: MatterEventId;
  // Purely informational, for the person holding the order: the open deadlines that referenced the
  // vacated setting (a lookup, not a cascade), and the bookings the status change just released by
  // derivation, so rooms can be re-booked at the new time if the new time is theirs to book.
  readonly triggerLinkedOpenDeadlines: readonly MatterDeadlineRow[];
  readonly releasedBookings: readonly LiveBookingRow[];
  readonly effect: EffectWrite;
}

export async function continueMatterEvent(
  database: SqlDatabase,
  eventId: MatterEventId,
  input: ContinueMatterEventInput,
  options: CalendarServiceOptions,
): Promise<ContinueMatterEventResult> {
  const existing = await readMatterEvent(database, eventId, options.visibility);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
  }
  // Refusals first, each with a name. The partial unique index would refuse the second continuance
  // anyway — it is the backstop under racing writes — but a named refusal beats a constraint abort.
  if (existing.status === "cancelled") {
    throw new CalendarValidationError(
      "calendar-event-not-continuable",
      "this setting is already cancelled; continue the live setting, or record a new event",
    );
  }
  const successor = await readContinuanceSuccessorLink(database, eventId);
  if (successor !== undefined) {
    throw new CalendarValidationError(
      "calendar-event-not-continuable",
      "this setting already has a successor; continue the latest setting in the chain",
    );
  }

  const merged = {
    title: existing.title,
    startsOn: input.startsOn,
    startsAtTime: input.startsAtTime === undefined ? existing.starts_at_time : input.startsAtTime,
    endsOn: input.endsOn === undefined ? existing.ends_on : input.endsOn,
    endsAtTime: input.endsAtTime === undefined ? existing.ends_at_time : input.endsAtTime,
    timeZone: input.timeZone ?? existing.time_zone,
  };
  assertEventShape(merged);

  // The informational lists, read before the batch so the response describes the world the person
  // is acting in: the bookings below are the ones the cancellation is about to release.
  const [triggerLinkedOpenDeadlines, releasedBookings] = await Promise.all([
    readOpenDeadlinesByTriggerEvent(database, eventId, {
      limit: 200,
      visibilityFragment: options.visibility.fragmentFor("matter_deadline.matter_id"),
      visibilityBindings: options.visibility.bindings,
    }),
    readBookingsForEvent(database, { matterEventId: eventId }),
  ]);

  const now = options.clock.now();
  const newEventId = newIdentifier("matterEvent", options.randomSource);
  const participants = await readMatterEventParticipants(database, eventId);

  const statements: SqlStatement[] = [
    // The new setting: the hearing as it now stands — same type, title carried over, participants
    // copied as a fresh replace-set (the same people are expected to appear; the caller edits if
    // not).
    insertMatterEventStatement(database, {
      id: newEventId,
      matterId: existing.matter_id,
      eventTypeId: existing.event_type_id,
      title: existing.title,
      description: existing.description,
      status: "scheduled",
      startsOn: merged.startsOn,
      startsAtTime: merged.startsAtTime,
      endsOn: merged.endsOn,
      endsAtTime: merged.endsAtTime,
      timeZone: merged.timeZone,
      locationText: input.locationText === undefined ? existing.location_text : input.locationText,
      courtReference:
        input.courtReference === undefined ? existing.court_reference : input.courtReference,
      recordedAt: now,
      recordedBy: options.actorUserId,
      now,
    }),
    ...participants.map((participant) =>
      insertMatterEventParticipantStatement(database, {
        id: newIdentifier("matterEventParticipant", options.randomSource),
        eventId: newEventId,
        participantKind: participant.participant_kind,
        memberUserId: participant.member_user_id,
        entityId: participant.entity_id,
        participantName: participant.participant_name,
        role: participant.role,
        now,
      }),
    ),
    // The old setting: cancelled — true, that setting will not occur — with the reason, and NOTHING
    // else touched. The honest-history test asserts every historical column stays byte-identical.
    cancelMatterEventStatement(database, eventId, now, input.statusReason ?? null),
    // One link, new setting to old, chain-held by the partial uniques.
    insertCalendarEventLinkStatement(database, {
      id: newIdentifier("calendarEventLink", options.randomSource),
      from: { matterEventId: newEventId },
      to: { matterEventId: eventId },
      kind: "continuance_of",
      note: null,
      recordedBy: options.actorUserId,
      now,
    }),
    // Identifiers only, on both audit rows.
    domainAuditStatement(database, {
      event: "calendar.event.continued",
      subjectId: eventId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { matterId: existing.matter_id, newEventId },
    }),
    domainAuditStatement(database, {
      event: "calendar.event.created",
      subjectId: newEventId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { matterId: existing.matter_id, continuedFromEventId: eventId },
    }),
  ];

  return {
    newEventId,
    oldEventId: eventId,
    triggerLinkedOpenDeadlines,
    releasedBookings,
    effect: { statements, outboxMessages: [] },
  };
}

// One node of the chain read: the setting with its dates, status, and reason — the full procedural
// history of one hearing, which is the thing the owner asked to be able to see.
export interface ContinuanceChainNode {
  readonly eventId: MatterEventId;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly timeZone: string;
  readonly status: string;
  readonly statusReason: string | null;
}

// Walks both directions from any node, bounded by the depth cap — a refusal past it, because a
// chain deeper than a hundred settings is corrupt data, not litigation. The link hops are one
// indexed read each, bounded by the chain's own length; the events then resolve through the
// visible-matter predicate in bulk.
export async function readContinuanceChain(
  database: SqlDatabase,
  eventId: MatterEventId,
  options: CalendarServiceOptions,
): Promise<ContinuanceChainNode[]> {
  const anchor = await readMatterEvent(database, eventId, options.visibility);
  if (anchor === undefined) {
    throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
  }

  const orderedIds: MatterEventId[] = [eventId];

  // Backwards: what this setting was continued from, then what that one was, and so on.
  let cursor: CalendarEventLinkRow | undefined = await readContinuancePredecessorLink(
    database,
    eventId,
  );
  while (cursor !== undefined) {
    const predecessorId = cursor.to_matter_event_id;
    if (predecessorId === null) break;
    orderedIds.unshift(predecessorId);
    assertChainDepth(orderedIds.length);
    cursor = await readContinuancePredecessorLink(database, predecessorId);
  }

  // Forwards: what continued this setting, and so on to the live end of the chain.
  let forward: CalendarEventLinkRow | undefined = await readContinuanceSuccessorLink(
    database,
    eventId,
  );
  while (forward !== undefined) {
    const successorId = forward.from_matter_event_id;
    if (successorId === null) break;
    orderedIds.push(successorId);
    assertChainDepth(orderedIds.length);
    forward = await readContinuanceSuccessorLink(database, successorId);
  }

  // The settings themselves, one bounded IN read under the same predicate every event read carries.
  type ChainNodeRow = Pick<
    MatterEventRow,
    "id" | "starts_on" | "starts_at_time" | "time_zone" | "status" | "status_reason"
  >;
  const { results } = await selectMatterEventChainNodesStatement(
    database,
    orderedIds,
    options.visibility,
  ).all<ChainNodeRow>();

  const byId = new Map<MatterEventId, ChainNodeRow>(results.map((row) => [row.id, row]));
  return orderedIds.flatMap((id) => {
    const row = byId.get(id);
    if (row === undefined) return [];
    return [
      {
        eventId: id,
        startsOn: row.starts_on,
        startsAtTime: row.starts_at_time,
        timeZone: row.time_zone,
        status: row.status,
        statusReason: row.status_reason,
      },
    ];
  });
}

function assertChainDepth(length: number): void {
  if (length > MAX_CONTINUANCE_CHAIN_DEPTH) {
    throw new CalendarValidationError(
      "calendar-continuance-chain-too-deep",
      `a continuance chain is walkable to ${MAX_CONTINUANCE_CHAIN_DEPTH} settings; past that the data is corrupt, not continued`,
    );
  }
}
