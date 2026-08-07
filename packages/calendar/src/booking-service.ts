import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmEventId,
  FirmResourceBookingId,
  FirmResourceId,
  MatterEventId,
} from "@magna-carta/identifiers/types";
import {
  deleteFirmResourceBookingStatement,
  insertFirmResourceBookingStatement,
  readFirmResourceBooking,
  readLiveBookingsInWindow,
  updateFirmResourceBookingStatement,
  type LiveBookingRow,
} from "./booking-statements.ts";
import type { CalendarServiceOptions } from "./event-service.ts";
import { readMatterEvent } from "./event-statements.ts";
import { readFirmEvent } from "./firm-event-statements.ts";
import { readFirmResource, readLocationTimeZone } from "./resource-statements.ts";
import { endOfCivilDayInstant, instantForCivilDateTime } from "./time-zone.ts";
import {
  CalendarValidationError,
  assertCivilDate,
  assertTimeZone,
  assertWallClockTime,
} from "./validation.ts";

// Booking a resource for an event, with the double-booking posture the whole subsystem argues for:
// WARN AND ALLOW, with the conflict visible everywhere. The write succeeds and the response carries
// the overlaps it created; the platform reports what it can see and does not adjudicate — the
// conflict may be a tentative hold, two groups sharing the big room, or about to vacate when the
// continuance is entered. Refusal would make the platform referee rooms it does not own, could not
// be held by the schema anyway (SQLite has no interval exclusion constraint, so a refusal is a
// race), and must never be the reason a hearing cannot be recorded.

// What a conflict carries: a booking reference with its window and its event's deep link — never a
// title. A room's schedule spans every matter, so the grid shape is exactly the firm-wide read the
// timeline label rule was written for.
export interface BookingConflict {
  readonly bookingId: FirmResourceBookingId;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly eventKind: "matterEvent" | "firmEvent";
  readonly eventId: string;
  readonly link: string;
}

interface BookingWindow {
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
}

// A booking's occupancy as a half-open instant interval, resolved through ITS OWN stored zone —
// the one piece of calendar arithmetic this file does, and it delegates to time-zone.ts. All-day
// bookings occupy their civil days in their zone; a timed booking with no end time holds the room
// through the end of its last civil day, because a room booked "from nine" with no end recorded is
// not free at one minute past nine.
export function bookingInterval(window: BookingWindow): { start: number; endExclusive: number } {
  const lastDay = window.ends_on ?? window.starts_on;
  const start = instantForCivilDateTime(window.starts_on, window.starts_at_time, window.time_zone);
  const endExclusive =
    window.ends_at_time !== null
      ? instantForCivilDateTime(lastDay, window.ends_at_time, window.time_zone)
      : endOfCivilDayInstant(lastDay, window.time_zone) + 1;
  return { start, endExclusive };
}

// One civil day either side, as a query-window widening — NOT date arithmetic on any recorded fact.
// Civil-date text comparison is zone-insensitive to within a day; the widening is what absorbs that
// before the precise per-zone comparison decides.
function widenedByOneDay(civilDate: string, direction: -1 | 1): string {
  return new Date(Date.parse(`${civilDate}T00:00:00.000Z`) + direction * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function toConflict(row: LiveBookingRow): BookingConflict {
  const eventId = row.matter_event_id ?? row.firm_event_id ?? "";
  return {
    bookingId: row.id,
    startsOn: row.starts_on,
    startsAtTime: row.starts_at_time,
    endsOn: row.ends_on,
    endsAtTime: row.ends_at_time,
    timeZone: row.time_zone,
    eventKind: row.event_kind,
    // The deep link into the owning read, behind that read's own access gate: a matter event on an
    // invisible matter is a 404 there, never a disclosure here.
    eventId,
    link: row.event_kind === "matterEvent" ? `/events/${eventId}` : `/firm-events/${eventId}`,
  };
}

// The two-stage overlap check. Stage one is ONE coarse SQL statement over the civil-date columns,
// widened one day each side, bounded by the calendar of one resource. Stage two resolves each
// returned row's wall-clock window through its own stored zone to instants and intersects — which
// almost never disagrees with a same-zone text comparison, but stays correct across the one edge
// (an office zone change leaving old rows in the old zone) a pure-SQL comparison would quietly get
// wrong.
export async function findBookingConflicts(
  database: SqlDatabase,
  options: {
    readonly resourceId: FirmResourceId;
    readonly candidate: BookingWindow;
    readonly excludeBookingId?: FirmResourceBookingId;
  },
): Promise<BookingConflict[]> {
  const lastDay = options.candidate.ends_on ?? options.candidate.starts_on;
  const rows = await readLiveBookingsInWindow(database, {
    resourceId: options.resourceId,
    fromDate: widenedByOneDay(options.candidate.starts_on, -1),
    toDate: widenedByOneDay(lastDay, 1),
    // A bound on rows read, not a page: one resource's bookings in a widened window is a handful
    // for any real room. Reached, the check under-reports — the warn posture's safe direction.
    limit: 500,
  });
  const candidate = bookingInterval(options.candidate);
  const conflicts: BookingConflict[] = [];
  for (const row of rows) {
    if (row.id === options.excludeBookingId) continue;
    const other = bookingInterval(row);
    if (candidate.start < other.endExclusive && other.start < candidate.endExclusive) {
      conflicts.push(toConflict(row));
    }
  }
  return conflicts;
}

export interface CreateBookingInput {
  readonly resourceId: FirmResourceId;
  // Exactly one, the schema's shape check restated as a named refusal.
  readonly matterEventId?: MatterEventId | null;
  readonly firmEventId?: FirmEventId | null;
  // Defaulted from the event where omitted; editable per booking (the setup-time case).
  readonly startsOn?: string | null;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  // The explicit-override path. Where omitted, the zone freezes from the resource's office, and
  // falls back to the event's own zone for a resource with no office or an office with no zone.
  readonly timeZone?: string | null;
}

function assertBookingWindowShape(window: BookingWindow): void {
  assertCivilDate(window.starts_on, "startsOn");
  assertWallClockTime(window.starts_at_time, "startsAtTime");
  if (window.ends_on !== null) {
    assertCivilDate(window.ends_on, "endsOn");
    if (window.ends_on < window.starts_on) {
      throw new CalendarValidationError(
        "calendar-invalid-range",
        "a booking cannot end before it starts",
      );
    }
  }
  assertWallClockTime(window.ends_at_time, "endsAtTime");
  if (window.ends_at_time !== null && window.starts_at_time === null) {
    throw new CalendarValidationError(
      "calendar-invalid-range",
      "an end time needs a start time on a booking, exactly as it does on an event",
    );
  }
  assertTimeZone(window.time_zone);
}

interface ResolvedEvent {
  readonly matterEventId: MatterEventId | null;
  readonly firmEventId: FirmEventId | null;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
}

async function resolveEvent(
  database: SqlDatabase,
  input: { matterEventId?: MatterEventId | null; firmEventId?: FirmEventId | null },
  options: CalendarServiceOptions,
): Promise<ResolvedEvent> {
  const matterEventId = input.matterEventId ?? null;
  const firmEventId = input.firmEventId ?? null;
  if ((matterEventId === null) === (firmEventId === null)) {
    throw new CalendarValidationError(
      "calendar-invalid-range",
      "a booking attaches to exactly one event: name a matter event or a firm event, never both and never neither",
    );
  }
  if (matterEventId !== null) {
    // Through the visible-matter predicate like every read of that table: booking a room for a
    // hearing the caller cannot see is a 404, not a probe.
    const event = await readMatterEvent(database, matterEventId, options.visibility);
    if (event === undefined) {
      throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
    }
    return {
      matterEventId,
      firmEventId: null,
      startsOn: event.starts_on,
      startsAtTime: event.starts_at_time,
      endsOn: event.ends_on,
      endsAtTime: event.ends_at_time,
      timeZone: event.time_zone,
    };
  }
  const event = await readFirmEvent(database, firmEventId as FirmEventId);
  if (event === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-firm-event",
      "no such firm event in this firm",
    );
  }
  return {
    matterEventId: null,
    firmEventId,
    startsOn: event.starts_on,
    startsAtTime: event.starts_at_time,
    endsOn: event.ends_on,
    endsAtTime: event.ends_at_time,
    timeZone: event.time_zone,
  };
}

export async function createFirmResourceBooking(
  database: SqlDatabase,
  input: CreateBookingInput,
  options: CalendarServiceOptions,
): Promise<{
  firmResourceBookingId: FirmResourceBookingId;
  conflicts: BookingConflict[];
  effect: EffectWrite;
}> {
  const resource = await readFirmResource(database, input.resourceId);
  if (resource === undefined) {
    throw new CalendarValidationError("calendar-unknown-resource", "no such resource in this firm");
  }
  if (resource.active !== 1) {
    // Soft-deactivation's meaning: existing bookings keep resolving, new ones are refused.
    throw new CalendarValidationError(
      "calendar-resource-inactive",
      `${resource.name} is deactivated and takes no new bookings`,
    );
  }
  const event = await resolveEvent(database, input, options);

  // The zone, frozen at the write: the caller's explicit override, else the resource's office, else
  // the event's own zone. Never re-derived afterward.
  const officeZone =
    resource.location_id === null
      ? null
      : await readLocationTimeZone(database, resource.location_id);
  const timeZone = input.timeZone ?? officeZone ?? event.timeZone;

  // The window, defaulted from the event where omitted. An explicit null start date is meaningless
  // (a booking has a date); explicit null TIMES are real — a vehicle taken for the whole day.
  const window: BookingWindow = {
    starts_on: input.startsOn ?? event.startsOn,
    starts_at_time: input.startsAtTime === undefined ? event.startsAtTime : input.startsAtTime,
    ends_on: input.endsOn === undefined ? event.endsOn : input.endsOn,
    ends_at_time: input.endsAtTime === undefined ? event.endsAtTime : input.endsAtTime,
    time_zone: timeZone,
  };
  assertBookingWindowShape(window);

  const conflicts = await findBookingConflicts(database, {
    resourceId: input.resourceId,
    candidate: window,
  });

  const now = options.clock.now();
  const firmResourceBookingId = newIdentifier("firmResourceBooking", options.randomSource);
  return {
    firmResourceBookingId,
    conflicts,
    effect: {
      statements: [
        insertFirmResourceBookingStatement(database, {
          id: firmResourceBookingId,
          resourceId: input.resourceId,
          matterEventId: event.matterEventId,
          firmEventId: event.firmEventId,
          startsOn: window.starts_on,
          startsAtTime: window.starts_at_time,
          endsOn: window.ends_on,
          endsAtTime: window.ends_at_time,
          timeZone: window.time_zone,
          recordedAt: now,
          recordedBy: options.actorUserId,
          now,
        }),
        // Identifiers only: which room, which event — never what the event is about.
        domainAuditStatement(database, {
          event: "calendar.booking.created",
          subjectId: firmResourceBookingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            resourceId: input.resourceId,
            eventId: event.matterEventId ?? event.firmEventId,
            conflictCount: conflicts.length,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface UpdateBookingInput {
  readonly startsOn?: string;
  readonly startsAtTime?: string | null;
  readonly endsOn?: string | null;
  readonly endsAtTime?: string | null;
  readonly timeZone?: string;
}

export async function updateFirmResourceBooking(
  database: SqlDatabase,
  firmResourceBookingId: FirmResourceBookingId,
  patch: UpdateBookingInput,
  options: CalendarServiceOptions,
): Promise<{ conflicts: BookingConflict[]; effect: EffectWrite }> {
  const existing = await readFirmResourceBooking(database, firmResourceBookingId);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-booking", "no such booking in this firm");
  }
  const window: BookingWindow = {
    starts_on: patch.startsOn ?? existing.starts_on,
    starts_at_time: patch.startsAtTime === undefined ? existing.starts_at_time : patch.startsAtTime,
    ends_on: patch.endsOn === undefined ? existing.ends_on : patch.endsOn,
    ends_at_time: patch.endsAtTime === undefined ? existing.ends_at_time : patch.endsAtTime,
    time_zone: patch.timeZone ?? existing.time_zone,
  };
  assertBookingWindowShape(window);
  const conflicts = await findBookingConflicts(database, {
    resourceId: existing.resource_id,
    candidate: window,
    excludeBookingId: firmResourceBookingId,
  });
  const now = options.clock.now();
  return {
    conflicts,
    effect: {
      statements: [
        updateFirmResourceBookingStatement(
          database,
          firmResourceBookingId,
          {
            startsOn: window.starts_on,
            startsAtTime: window.starts_at_time,
            endsOn: window.ends_on,
            endsAtTime: window.ends_at_time,
            timeZone: window.time_zone,
          },
          now,
        ),
        domainAuditStatement(database, {
          event: "calendar.booking.updated",
          subjectId: firmResourceBookingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { resourceId: existing.resource_id, conflictCount: conflicts.length },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export async function deleteFirmResourceBooking(
  database: SqlDatabase,
  firmResourceBookingId: FirmResourceBookingId,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readFirmResourceBooking(database, firmResourceBookingId);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-booking", "no such booking in this firm");
  }
  return {
    effect: {
      statements: [
        deleteFirmResourceBookingStatement(database, firmResourceBookingId),
        domainAuditStatement(database, {
          event: "calendar.booking.deleted",
          subjectId: firmResourceBookingId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { resourceId: existing.resource_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// The availability read: one statement (the liveness join inside it), rows bounded by one
// resource's window, conflicts pre-paired in application code over those same rows so the grid can
// paint collisions without a second request.
export interface AvailabilityEntry {
  readonly bookingId: FirmResourceBookingId;
  readonly startsOn: string;
  readonly startsAtTime: string | null;
  readonly endsOn: string | null;
  readonly endsAtTime: string | null;
  readonly timeZone: string;
  readonly eventKind: "matterEvent" | "firmEvent";
  readonly eventId: string;
  // The catalog term, never the event's title: "Booked — deposition" is renderable without
  // disclosure, and the detail lives behind the deep link's own access gate.
  readonly eventTypeName: string | null;
  readonly link: string;
  readonly overlappingBookingIds: readonly FirmResourceBookingId[];
}

export async function readResourceAvailability(
  database: SqlDatabase,
  options: {
    readonly resourceId: FirmResourceId;
    readonly fromDate: string;
    readonly toDate: string;
  },
): Promise<AvailabilityEntry[]> {
  const rows = await readLiveBookingsInWindow(database, {
    resourceId: options.resourceId,
    fromDate: options.fromDate,
    toDate: options.toDate,
    limit: 2000,
  });
  const intervals = rows.map((row) => bookingInterval(row));
  return rows.map((row, index) => {
    const overlapping: FirmResourceBookingId[] = [];
    for (let other = 0; other < rows.length; other += 1) {
      if (other === index) continue;
      const a = intervals[index];
      const b = intervals[other];
      if (
        a !== undefined &&
        b !== undefined &&
        a.start < b.endExclusive &&
        b.start < a.endExclusive
      ) {
        const otherRow = rows[other];
        if (otherRow !== undefined) overlapping.push(otherRow.id);
      }
    }
    const conflict = toConflict(row);
    return {
      bookingId: row.id,
      startsOn: row.starts_on,
      startsAtTime: row.starts_at_time,
      endsOn: row.ends_on,
      endsAtTime: row.ends_at_time,
      timeZone: row.time_zone,
      eventKind: row.event_kind,
      eventId: conflict.eventId,
      eventTypeName: row.event_type_name,
      link: conflict.link,
      overlappingBookingIds: overlapping,
    };
  });
}
