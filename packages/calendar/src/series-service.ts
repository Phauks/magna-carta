import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  formatRecurrence,
  isOccurrenceOf,
  movedLikeOccurrence,
  occurrencesOf,
  parseRecurrence,
  splitSeriesAt,
  type RecurrenceRule,
} from "@magna-carta/civil-time/recurrence";
import type { FirmEventId, MatterEventId, MatterId, UserId } from "@magna-carta/identifiers/types";
import {
  createMatterEvent,
  updateMatterEvent,
  type CalendarServiceOptions,
  type CreateMatterEventInput,
  type MatterEventParticipantInput,
  type UpdateMatterEventInput,
} from "./event-service.ts";
import {
  cancelMatterEventStatement,
  MATTER_EVENT_TABLE,
  readMatterEvent,
  readMatterEventParticipants,
  type MatterEventParticipantRow,
  type MatterEventRow,
} from "./event-statements.ts";
import {
  createFirmEvent,
  updateFirmEvent,
  type CreateFirmEventInput,
  type UpdateFirmEventInput,
} from "./firm-event-service.ts";
import {
  cancelFirmEventStatement,
  FIRM_EVENT_TABLE,
  readFirmEvent,
  readFirmEventParticipants,
  type FirmEventParticipantRow,
  type FirmEventRow,
} from "./firm-event-statements.ts";
import { MATTER_EVENT_TYPE_TABLE } from "./event-type-statements.ts";
import {
  CALENDAR_EVENT_CANCELLED_TOPIC,
  CALENDAR_EVENT_RESCHEDULED_TOPIC,
  type CalendarEventTopicPayload,
} from "./notifications.ts";
import type { FirmEventAudience, MatterEventStatus } from "./types.ts";
import { assertCalendarWindow, CalendarValidationError } from "./validation.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";

// A REPEATING SETTING ON THE CALENDAR, AND ONE DAY OF IT CHANGED.
//
// The series is one row carrying an RFC 5545 rule; the days it falls on are read back from that rule
// when somebody asks for a window, never stored. This module is both halves of that:
//
//   READ   the series whose rule could touch a window, with the days inside the window each one
//          falls on. The day arithmetic is @magna-carta/civil-time's `occurrencesOf`, the same walk
//          the record form previews, so the grid and the form can never disagree about a date.
//   WRITE  a change to ONE occurrence ("this event only"), or to an occurrence and every one after it
//          ("this and all later events"). A change to the whole series is an ordinary edit of the
//          series row and needs nothing from here.
//
// One occurrence changed is an EXCEPTION: a real event row that names its series and the day of it
// it stands in for (`recurrence_parent_id`, `recurrence_occurrence_on`). The read skips that day, and
// the exception is painted by the ordinary reads like any other event — so a cancelled occurrence
// stays visible and struck by the rule that already holds for every cancelled setting.
//
// "This and all later" CUTS the series: the old row's rule ends the day before, and a new series
// starts on the occurrence with the change applied, carrying the rest of the count. What already
// happened is never rewritten — a status conference held in October keeps October's judge. The
// exceptions already written for days after the cut move to the new series, so a day somebody moved
// by hand stays moved and is not painted twice.

/** The most series one window read returns before it says it stopped. */
export const MAX_SERIES_PER_READ = 200;

/** Which side of the firm's calendar a series read covers: a matter's settings, the firm's own, or both. */
export type SeriesSide = "matter" | "firm" | "all";

export interface SeriesWindowRequest {
  readonly fromDate: string;
  readonly toDate: string;
  readonly side: SeriesSide;
  /** One matter's series only, which is also what lets a series carry its title. */
  readonly matterId?: MatterId;
  /** Only the series on this member's calendar, resolved in SQL exactly as the timeline does it. */
  readonly memberUserId?: UserId;
  readonly visibility: VisibleMatterPredicate;
}

/**
 * One series and the days it falls on inside the window.
 *
 * A MATTER series read across the firm carries no title, for the reason the federated read carries
 * none: free text about a case does not belong on a read spanning every case. It carries the platform
 * type code instead. Read for one matter, it carries the title and the type's name, as that matter's
 * own event list does. A firm series always carries its title, as the firm's own listing does.
 */
export interface SeriesOccurrences {
  readonly source: "matterEvent" | "firmEvent";
  readonly id: string;
  readonly matterId: string | null;
  readonly title: string | null;
  readonly typeCode: string | null;
  readonly typeName: string | null;
  readonly audience: FirmEventAudience | null;
  readonly status: MatterEventStatus;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly recurrenceRule: string;
  /** Every day in the window the series falls on, the first day included, exceptions left out. */
  readonly occurrences: readonly string[];
}

export interface SeriesWindowResult {
  readonly series: readonly SeriesOccurrences[];
  /** True where more series could touch the window than one read returns. */
  readonly truncated: boolean;
}

interface MatterSeriesRow {
  readonly id: string;
  readonly matter_id: string;
  readonly title: string;
  readonly status: MatterEventStatus;
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
  readonly recurrence_rule: string;
  readonly type_code: string | null;
  readonly type_name: string | null;
}

interface FirmSeriesRow {
  readonly id: string;
  readonly title: string;
  readonly status: MatterEventStatus;
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
  readonly recurrence_rule: string;
  readonly audience: FirmEventAudience;
  readonly type_name: string | null;
}

interface ExceptionRow {
  readonly recurrence_parent_id: string;
  readonly recurrence_occurrence_on: string;
}

// A series could touch the window when it starts on or before the window closes. Whether its rule
// has run out before the window opens is a question SQL cannot answer about an RRULE, so it is
// answered by the walk, which returns no days for a series that ended earlier.
function matterSeriesStatement(database: SqlDatabase, request: SeriesWindowRequest): SqlStatement {
  const conditions = [
    `${MATTER_EVENT_TABLE}.recurrence_rule IS NOT NULL`,
    `${MATTER_EVENT_TABLE}.recurrence_parent_id IS NULL`,
    `${MATTER_EVENT_TABLE}.starts_on <= ?`,
  ];
  const bindings: unknown[] = [request.toDate];
  if (request.matterId !== undefined) {
    conditions.push(`${MATTER_EVENT_TABLE}.matter_id = ?`);
    bindings.push(request.matterId);
  }
  if (request.memberUserId !== undefined) {
    conditions.push(
      "(EXISTS (SELECT 1 FROM matter_event_participant WHERE matter_event_participant.event_id = matter_event.id AND matter_event_participant.member_user_id = ?)" +
        " OR EXISTS (SELECT 1 FROM matter AS responsible_matter WHERE responsible_matter.id = matter_event.matter_id AND responsible_matter.responsible_member_id = ?))",
    );
    bindings.push(request.memberUserId, request.memberUserId);
  }
  conditions.push(request.visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`));
  bindings.push(...request.visibility.bindings);
  bindings.push(MAX_SERIES_PER_READ + 1);
  return database
    .prepare(
      `SELECT ${MATTER_EVENT_TABLE}.id, ${MATTER_EVENT_TABLE}.matter_id, ${MATTER_EVENT_TABLE}.title, ` +
        `${MATTER_EVENT_TABLE}.status, ${MATTER_EVENT_TABLE}.starts_on, ${MATTER_EVENT_TABLE}.starts_at_time, ` +
        `${MATTER_EVENT_TABLE}.ends_on, ${MATTER_EVENT_TABLE}.ends_at_time, ${MATTER_EVENT_TABLE}.time_zone, ` +
        `${MATTER_EVENT_TABLE}.recurrence_rule, ` +
        `CASE WHEN ${MATTER_EVENT_TYPE_TABLE}.origin = 'platform' THEN ${MATTER_EVENT_TYPE_TABLE}.code ELSE NULL END AS type_code, ` +
        `${MATTER_EVENT_TYPE_TABLE}.name AS type_name ` +
        `FROM ${MATTER_EVENT_TABLE} LEFT JOIN ${MATTER_EVENT_TYPE_TABLE} ON ${MATTER_EVENT_TYPE_TABLE}.id = ${MATTER_EVENT_TABLE}.event_type_id ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${MATTER_EVENT_TABLE}.starts_on ASC, ${MATTER_EVENT_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings);
}

// The firm's own series. No visible-matter predicate, for the reason no firm-event read composes one:
// a firm event has no matter (firm-event-statements.ts says why at length).
function firmSeriesStatement(database: SqlDatabase, request: SeriesWindowRequest): SqlStatement {
  const conditions = [
    `${FIRM_EVENT_TABLE}.recurrence_rule IS NOT NULL`,
    `${FIRM_EVENT_TABLE}.recurrence_parent_id IS NULL`,
    `${FIRM_EVENT_TABLE}.starts_on <= ?`,
  ];
  const bindings: unknown[] = [request.toDate];
  if (request.memberUserId !== undefined) {
    conditions.push(
      "(firm_event.audience = 'all_members'" +
        " OR EXISTS (SELECT 1 FROM firm_event_participant WHERE firm_event_participant.firm_event_id = firm_event.id AND firm_event_participant.member_user_id = ?))",
    );
    bindings.push(request.memberUserId);
  }
  bindings.push(MAX_SERIES_PER_READ + 1);
  return database
    .prepare(
      `SELECT ${FIRM_EVENT_TABLE}.id, ${FIRM_EVENT_TABLE}.title, ${FIRM_EVENT_TABLE}.status, ` +
        `${FIRM_EVENT_TABLE}.starts_on, ${FIRM_EVENT_TABLE}.starts_at_time, ${FIRM_EVENT_TABLE}.ends_on, ` +
        `${FIRM_EVENT_TABLE}.ends_at_time, ${FIRM_EVENT_TABLE}.time_zone, ${FIRM_EVENT_TABLE}.recurrence_rule, ` +
        `${FIRM_EVENT_TABLE}.audience, ${MATTER_EVENT_TYPE_TABLE}.name AS type_name ` +
        `FROM ${FIRM_EVENT_TABLE} LEFT JOIN ${MATTER_EVENT_TYPE_TABLE} ON ${MATTER_EVENT_TYPE_TABLE}.id = ${FIRM_EVENT_TABLE}.event_type_id ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${FIRM_EVENT_TABLE}.starts_on ASC, ${FIRM_EVENT_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings);
}

// The days of the read's series that an exception already stands in for. One statement per side,
// bounded by the series the read returned, under the same predicate the series read carried.
function matterExceptionsStatement(
  database: SqlDatabase,
  seriesIds: readonly string[],
  request: SeriesWindowRequest,
): SqlStatement {
  const placeholders = seriesIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT recurrence_parent_id, recurrence_occurrence_on FROM ${MATTER_EVENT_TABLE} ` +
        `WHERE recurrence_parent_id IN (${placeholders}) AND recurrence_occurrence_on >= ? AND recurrence_occurrence_on <= ? AND ` +
        request.visibility.fragmentFor(`${MATTER_EVENT_TABLE}.matter_id`),
    )
    .bind(...seriesIds, request.fromDate, request.toDate, ...request.visibility.bindings);
}

function firmExceptionsStatement(
  database: SqlDatabase,
  seriesIds: readonly string[],
  request: SeriesWindowRequest,
): SqlStatement {
  const placeholders = seriesIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT recurrence_parent_id, recurrence_occurrence_on FROM ${FIRM_EVENT_TABLE} ` +
        `WHERE recurrence_parent_id IN (${placeholders}) AND recurrence_occurrence_on >= ? AND recurrence_occurrence_on <= ?`,
    )
    .bind(...seriesIds, request.fromDate, request.toDate);
}

function exceptionDaysBySeries(rows: readonly ExceptionRow[]): Map<string, Set<string>> {
  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    const held = days.get(row.recurrence_parent_id) ?? new Set<string>();
    held.add(row.recurrence_occurrence_on);
    days.set(row.recurrence_parent_id, held);
  }
  return days;
}

/** The days a stored series falls on in the window, less the ones an exception replaces. */
function daysInWindow(
  line: string,
  startsOn: string,
  request: SeriesWindowRequest,
  replaced: ReadonlySet<string> | undefined,
): string[] {
  // A rule this platform cannot read was refused at the write; one that arrived anyway is painted on
  // its first day only, where the ordinary reads already put it, rather than guessed at.
  const rule = parseRecurrence(line);
  if (rule === null) return [];
  return occurrencesOf(rule, startsOn, { from: request.fromDate, to: request.toDate }).filter(
    (day) => replaced?.has(day) !== true,
  );
}

/**
 * The series that fall inside a window, each with its days there. The window is capped as every
 * calendar window is — a refusal, never a clamp — which is also what bounds the walk.
 */
export async function readSeriesInWindow(
  database: SqlDatabase,
  request: SeriesWindowRequest,
): Promise<SeriesWindowResult> {
  assertCalendarWindow(request.fromDate, request.toDate);
  const readsMatter = request.side !== "firm";
  // A matter's own calendar has no firm events on it.
  const readsFirm = request.side !== "matter" && request.matterId === undefined;

  const matterRows = readsMatter
    ? (await matterSeriesStatement(database, request).all<MatterSeriesRow>()).results
    : [];
  const firmRows = readsFirm
    ? (await firmSeriesStatement(database, request).all<FirmSeriesRow>()).results
    : [];
  const truncated =
    matterRows.length > MAX_SERIES_PER_READ || firmRows.length > MAX_SERIES_PER_READ;
  const matterSeries = matterRows.slice(0, MAX_SERIES_PER_READ);
  const firmSeries = firmRows.slice(0, MAX_SERIES_PER_READ);

  const matterReplaced =
    matterSeries.length === 0
      ? new Map<string, Set<string>>()
      : exceptionDaysBySeries(
          (
            await matterExceptionsStatement(
              database,
              matterSeries.map((row) => row.id),
              request,
            ).all<ExceptionRow>()
          ).results,
        );
  const firmReplaced =
    firmSeries.length === 0
      ? new Map<string, Set<string>>()
      : exceptionDaysBySeries(
          (
            await firmExceptionsStatement(
              database,
              firmSeries.map((row) => row.id),
              request,
            ).all<ExceptionRow>()
          ).results,
        );

  const forOneMatter = request.matterId !== undefined;
  const series: SeriesOccurrences[] = [];
  for (const row of matterSeries) {
    const occurrences = daysInWindow(
      row.recurrence_rule,
      row.starts_on,
      request,
      matterReplaced.get(row.id),
    );
    if (occurrences.length === 0) continue;
    series.push({
      source: "matterEvent",
      id: row.id,
      matterId: row.matter_id,
      title: forOneMatter ? row.title : null,
      typeCode: row.type_code,
      typeName: forOneMatter ? row.type_name : null,
      audience: null,
      status: row.status,
      startsOn: row.starts_on,
      startsAtTime: row.starts_at_time,
      endsOn: row.ends_on,
      endsAtTime: row.ends_at_time,
      timeZone: row.time_zone,
      recurrenceRule: row.recurrence_rule,
      occurrences,
    });
  }
  for (const row of firmSeries) {
    const occurrences = daysInWindow(
      row.recurrence_rule,
      row.starts_on,
      request,
      firmReplaced.get(row.id),
    );
    if (occurrences.length === 0) continue;
    series.push({
      source: "firmEvent",
      id: row.id,
      matterId: null,
      title: row.title,
      typeCode: null,
      typeName: row.type_name,
      audience: row.audience,
      status: row.status,
      startsOn: row.starts_on,
      startsAtTime: row.starts_at_time,
      endsOn: row.ends_on,
      endsAtTime: row.ends_at_time,
      timeZone: row.time_zone,
      recurrenceRule: row.recurrence_rule,
      occurrences,
    });
  }
  return { series, truncated };
}

// ---- changing one occurrence, or an occurrence and every one after it --------------------------

/** "this": the one occurrence. "following": it and every later one. The whole series is a plain edit. */
export type OccurrenceScope = "this" | "following";

export type OccurrenceChange<Patch> =
  | { readonly kind: "update"; readonly fields: Patch }
  | { readonly kind: "cancel"; readonly statusReason: string | null };

interface SeriesFacts {
  readonly rule: RecurrenceRule;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly line: string;
}

/** The stored row as a series, or a refusal naming why it is not one this change can apply to. */
function seriesFactsOf(
  row: {
    readonly recurrence_rule: string | null;
    readonly recurrence_parent_id: string | null;
    readonly starts_on: string;
    readonly ends_on: string | null;
  },
  occurrenceOn: string,
): SeriesFacts {
  const rule = parseRecurrence(row.recurrence_rule);
  if (row.recurrence_rule === null || rule === null || row.recurrence_parent_id !== null) {
    throw new CalendarValidationError(
      "calendar-not-a-series",
      "this event does not repeat on a rule this platform can change one day of",
    );
  }
  if (!isOccurrenceOf(rule, row.starts_on, occurrenceOn)) {
    throw new CalendarValidationError(
      "calendar-not-an-occurrence",
      `${occurrenceOn} is not a day this series falls on`,
    );
  }
  return { rule, startsOn: row.starts_on, endsOn: row.ends_on, line: row.recurrence_rule };
}

/**
 * Where one occurrence ends, as the series' own span carried onto that day: a two-day series' Friday
 * occurrence runs to Saturday. Null where the series is one day long.
 */
function occurrenceEnd(facts: SeriesFacts, occurrenceOn: string): string | null {
  if (facts.endsOn === null) return null;
  return movedLikeOccurrence(facts.endsOn, facts.startsOn, occurrenceOn);
}

/**
 * The rule the later half of a cut series runs on. Where the change left the rule as it was, the
 * later half carries what remains of it — the rest of a count, not a fresh one. Where the change
 * wrote a rule of its own, that rule is what the person asked for.
 */
function laterRule(
  facts: SeriesFacts,
  occurrenceOn: string,
  fieldsRule: string | null | undefined,
) {
  if (fieldsRule !== undefined && fieldsRule !== facts.line) return fieldsRule;
  return formatRecurrence(splitSeriesAt(facts.rule, facts.startsOn, occurrenceOn).after);
}

function combined(...effects: readonly EffectWrite[]): EffectWrite {
  return {
    statements: effects.flatMap((effect) => effect.statements),
    outboxMessages: effects.flatMap((effect) => effect.outboxMessages ?? []),
  };
}

function participantInputs(
  rows: readonly (MatterEventParticipantRow | FirmEventParticipantRow)[],
): MatterEventParticipantInput[] {
  return rows.map((row) => ({
    participantKind: row.participant_kind,
    memberUserId: row.member_user_id,
    entityId: row.entity_id,
    participantName: row.participant_name,
    role: row.role,
  }));
}

/** Refuses a day somebody already changed: the exception is the occurrence now, and it is edited. */
async function assertNotYetChanged(
  database: SqlDatabase,
  table: string,
  seriesId: string,
  occurrenceOn: string,
  visibility: VisibleMatterPredicate | null,
): Promise<void> {
  const predicate =
    visibility === null ? "" : ` AND ${visibility.fragmentFor(`${table}.matter_id`)}`;
  const { results } = await database
    .prepare(
      `SELECT id FROM ${table} WHERE recurrence_parent_id = ? AND recurrence_occurrence_on = ?${predicate} LIMIT 1`,
    )
    .bind(seriesId, occurrenceOn, ...(visibility?.bindings ?? []))
    .all<{ id: string }>();
  if (results.length > 0) {
    throw new CalendarValidationError(
      "calendar-occurrence-already-changed",
      `the ${occurrenceOn} occurrence was already changed; edit that event instead`,
    );
  }
}

/**
 * The statements that move the exceptions already written for days on or after a cut onto the new
 * series, so the later half skips them exactly as the whole series did.
 */
function reparentStatement(
  database: SqlDatabase,
  table: string,
  oldSeriesId: string,
  newSeriesId: string,
  occurrenceOn: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${table} SET recurrence_parent_id = ? WHERE recurrence_parent_id = ? AND recurrence_occurrence_on >= ?`,
    )
    .bind(newSeriesId, oldSeriesId, occurrenceOn);
}

/** Cancels the exceptions already written for days on or after a cut, when the rest is called off. */
function cancelLaterExceptionsStatement(
  database: SqlDatabase,
  table: string,
  seriesId: string,
  occurrenceOn: string,
  now: string,
  statusReason: string | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${table} SET status = 'cancelled', status_reason = ?, updated_at = ? ` +
        `WHERE recurrence_parent_id = ? AND recurrence_occurrence_on >= ? AND status != 'cancelled'`,
    )
    .bind(statusReason, now, seriesId, occurrenceOn);
}

// ---- matter events ----

function matterExceptionBase(
  existing: MatterEventRow,
  facts: SeriesFacts,
  occurrenceOn: string,
  participants: readonly MatterEventParticipantInput[],
): CreateMatterEventInput {
  return {
    matterId: existing.matter_id,
    eventTypeId: existing.event_type_id,
    title: existing.title,
    description: existing.description,
    startsOn: occurrenceOn,
    startsAtTime: existing.starts_at_time,
    endsOn: occurrenceEnd(facts, occurrenceOn),
    endsAtTime: existing.ends_at_time,
    timeZone: existing.time_zone,
    locationText: existing.location_text,
    conferenceUrl: existing.conference_url,
    courtReference: existing.court_reference,
    recurrenceRule: null,
    participants,
  };
}

/** The base with the change's fields over it, a field the change did not name keeping the base's. */
function withFields<Base extends object, Fields extends object>(base: Base, fields: Fields): Base {
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as Base;
}

function matterPayload(eventId: string, matterId: string): CalendarEventTopicPayload {
  return { matterEventId: eventId as MatterEventId, matterId: matterId as MatterId };
}

/**
 * Change one occurrence of a matter event's series, or it and every later one.
 *
 * The announcement follows what happened rather than which rows were written: one occurrence moved is
 * a reschedule of that setting, one called off is a cancellation, and an edit that moved nothing
 * announces nothing — the same rule the plain edit keeps. An exception's own creation is never
 * announced as a new setting, because nobody scheduled anything.
 */
export async function changeMatterEventOccurrence(
  database: SqlDatabase,
  seriesId: MatterEventId,
  occurrenceOn: string,
  scope: OccurrenceScope,
  change: OccurrenceChange<UpdateMatterEventInput>,
  options: CalendarServiceOptions,
): Promise<{ id: string; effect: EffectWrite }> {
  const existing = await readMatterEvent(database, seriesId, options.visibility);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
  }
  const facts = seriesFactsOf(existing, occurrenceOn);
  const participants = participantInputs(await readMatterEventParticipants(database, seriesId));
  const base = matterExceptionBase(existing, facts, occurrenceOn, participants);

  if (scope === "this") {
    await assertNotYetChanged(
      database,
      MATTER_EVENT_TABLE,
      seriesId,
      occurrenceOn,
      options.visibility,
    );
    const fields = change.kind === "update" ? change.fields : {};
    const input: CreateMatterEventInput = {
      ...withFields(base, fields),
      recurrenceRule: null,
      recurrenceParentId: seriesId,
      recurrenceOccurrenceOn: occurrenceOn,
    };
    const created = createMatterEvent(database, input, options);
    const payload = matterPayload(created.eventId, existing.matter_id);
    if (change.kind === "cancel") {
      return {
        id: created.eventId,
        effect: {
          statements: [
            ...created.effect.statements,
            cancelMatterEventStatement(
              database,
              created.eventId,
              options.clock.now(),
              change.statusReason,
            ),
          ],
          outboxMessages: [{ topic: CALENDAR_EVENT_CANCELLED_TOPIC, payload }],
        },
      };
    }
    const moved =
      input.startsOn !== base.startsOn ||
      (input.startsAtTime ?? null) !== (base.startsAtTime ?? null) ||
      (input.endsOn ?? null) !== (base.endsOn ?? null) ||
      (input.endsAtTime ?? null) !== (base.endsAtTime ?? null) ||
      input.timeZone !== base.timeZone;
    return {
      id: created.eventId,
      effect: {
        statements: created.effect.statements,
        outboxMessages: moved ? [{ topic: CALENDAR_EVENT_RESCHEDULED_TOPIC, payload }] : [],
      },
    };
  }

  // "following" from the series' first day is the whole series.
  const { before } = splitSeriesAt(facts.rule, facts.startsOn, occurrenceOn);
  if (before === null) {
    if (change.kind === "cancel") {
      throw new CalendarValidationError(
        "calendar-not-an-occurrence",
        "every occurrence from the first is the whole series; cancel the series itself",
      );
    }
    const { effect } = await updateMatterEvent(database, seriesId, change.fields, options);
    return { id: seriesId, effect };
  }
  const now = options.clock.now();
  const ended = await updateMatterEvent(
    database,
    seriesId,
    { recurrenceRule: formatRecurrence(before) },
    options,
  );
  if (change.kind === "cancel") {
    return {
      id: seriesId,
      effect: combined(ended.effect, {
        statements: [
          cancelLaterExceptionsStatement(
            database,
            MATTER_EVENT_TABLE,
            seriesId,
            occurrenceOn,
            now,
            change.statusReason,
          ),
        ],
        outboxMessages: [
          {
            topic: CALENDAR_EVENT_CANCELLED_TOPIC,
            payload: matterPayload(seriesId, existing.matter_id),
          },
        ],
      }),
    };
  }
  const later: CreateMatterEventInput = {
    ...withFields(base, change.fields),
    recurrenceRule: laterRule(facts, occurrenceOn, change.fields.recurrenceRule),
  };
  const created = createMatterEvent(database, later, options);
  return {
    id: created.eventId,
    effect: combined(ended.effect, {
      statements: [
        ...created.effect.statements,
        reparentStatement(database, MATTER_EVENT_TABLE, seriesId, created.eventId, occurrenceOn),
      ],
      // The later half is the same setting continuing on its new terms, announced as a reschedule
      // rather than as something newly scheduled.
      outboxMessages: [
        {
          topic: CALENDAR_EVENT_RESCHEDULED_TOPIC,
          payload: matterPayload(created.eventId, existing.matter_id),
        },
      ],
    }),
  };
}

// ---- firm events ----

function firmExceptionBase(
  existing: FirmEventRow,
  facts: SeriesFacts,
  occurrenceOn: string,
  participants: readonly MatterEventParticipantInput[],
): CreateFirmEventInput {
  return {
    eventTypeId: existing.event_type_id,
    title: existing.title,
    description: existing.description,
    startsOn: occurrenceOn,
    startsAtTime: existing.starts_at_time,
    endsOn: occurrenceEnd(facts, occurrenceOn),
    endsAtTime: existing.ends_at_time,
    timeZone: existing.time_zone,
    audience: existing.audience,
    locationId: existing.location_id,
    locationText: existing.location_text,
    conferenceUrl: existing.conference_url,
    recurrenceRule: null,
    participants,
  };
}

/** Change one occurrence of a firm event's series, or it and every later one. */
export async function changeFirmEventOccurrence(
  database: SqlDatabase,
  seriesId: FirmEventId,
  occurrenceOn: string,
  scope: OccurrenceScope,
  change: OccurrenceChange<UpdateFirmEventInput>,
  options: CalendarServiceOptions,
): Promise<{ id: string; effect: EffectWrite }> {
  const existing = await readFirmEvent(database, seriesId);
  if (existing === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-firm-event",
      "no such firm event in this firm",
    );
  }
  const facts = seriesFactsOf(existing, occurrenceOn);
  const participants = participantInputs(await readFirmEventParticipants(database, seriesId));
  const base = firmExceptionBase(existing, facts, occurrenceOn, participants);

  if (scope === "this") {
    await assertNotYetChanged(database, FIRM_EVENT_TABLE, seriesId, occurrenceOn, null);
    const fields = change.kind === "update" ? change.fields : {};
    const created = await createFirmEvent(
      database,
      {
        ...withFields(base, fields),
        recurrenceRule: null,
        recurrenceParentId: seriesId,
        recurrenceOccurrenceOn: occurrenceOn,
      },
      options,
    );
    if (change.kind === "update") return { id: created.firmEventId, effect: created.effect };
    return {
      id: created.firmEventId,
      effect: combined(created.effect, {
        statements: [
          cancelFirmEventStatement(
            database,
            created.firmEventId,
            options.clock.now(),
            change.statusReason,
          ),
        ],
        outboxMessages: [],
      }),
    };
  }

  const { before } = splitSeriesAt(facts.rule, facts.startsOn, occurrenceOn);
  if (before === null) {
    if (change.kind === "cancel") {
      throw new CalendarValidationError(
        "calendar-not-an-occurrence",
        "every occurrence from the first is the whole series; cancel the series itself",
      );
    }
    const { effect } = await updateFirmEvent(database, seriesId, change.fields, options);
    return { id: seriesId, effect };
  }
  const now = options.clock.now();
  const ended = await updateFirmEvent(
    database,
    seriesId,
    { recurrenceRule: formatRecurrence(before) },
    options,
  );
  if (change.kind === "cancel") {
    return {
      id: seriesId,
      effect: combined(ended.effect, {
        statements: [
          cancelLaterExceptionsStatement(
            database,
            FIRM_EVENT_TABLE,
            seriesId,
            occurrenceOn,
            now,
            change.statusReason,
          ),
        ],
        outboxMessages: [],
      }),
    };
  }
  const created = await createFirmEvent(
    database,
    {
      ...withFields(base, change.fields),
      recurrenceRule: laterRule(facts, occurrenceOn, change.fields.recurrenceRule),
    },
    options,
  );
  return {
    id: created.firmEventId,
    effect: combined(ended.effect, created.effect, {
      statements: [
        reparentStatement(database, FIRM_EVENT_TABLE, seriesId, created.firmEventId, occurrenceOn),
      ],
      outboxMessages: [],
    }),
  };
}
