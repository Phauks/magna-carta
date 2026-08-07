import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FirmEventId,
  FirmResourceBookingId,
  FirmResourceId,
  MatterEventId,
  UserId,
} from "@magna-carta/identifiers/types";

// A booking occupies one resource for one event's sake. Its LIVENESS IS DERIVED, never stored: a
// booking blocks the room if and only if its event's status is not 'cancelled', which is why every
// read here joins the two event tables for status instead of trusting a flag that could drift.
// Cancelling or continuing an event releases its rooms atomically and unforgettably, because
// releasing is not an action at all.

export const FIRM_RESOURCE_BOOKING_TABLE = "firm_resource_booking";

export interface FirmResourceBookingRow {
  readonly id: FirmResourceBookingId;
  readonly resource_id: FirmResourceId;
  readonly matter_event_id: MatterEventId | null;
  readonly firm_event_id: FirmEventId | null;
  readonly starts_on: string;
  readonly starts_at_time: string | null;
  readonly ends_on: string | null;
  readonly ends_at_time: string | null;
  readonly time_zone: string;
  readonly recorded_at: string;
  readonly recorded_by: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// A booking row with its event's liveness joined in — the shape both the availability read and the
// overlap check consume. The event's own content stays where it lives: the join takes the STATUS,
// the event's kind, and its catalog type, never a title.
export interface LiveBookingRow extends FirmResourceBookingRow {
  readonly event_status: string;
  readonly event_kind: "matterEvent" | "firmEvent";
  readonly event_type_name: string | null;
}

const BOOKING_COLUMNS =
  "id, resource_id, matter_event_id, firm_event_id, starts_on, starts_at_time, ends_on, ends_at_time, " +
  "time_zone, recorded_at, recorded_by, created_at, updated_at";

const QUALIFIED_BOOKING_COLUMNS = BOOKING_COLUMNS.split(", ")
  .map((column) => `${FIRM_RESOURCE_BOOKING_TABLE}.${column}`)
  .join(", ");

// The liveness join, written once. COALESCE is safe because the schema holds exactly one of the two
// event columns non-null.
const LIVE_BOOKING_SELECT =
  `SELECT ${QUALIFIED_BOOKING_COLUMNS}, ` +
  `COALESCE(matter_event.status, firm_event.status) AS event_status, ` +
  `CASE WHEN ${FIRM_RESOURCE_BOOKING_TABLE}.matter_event_id IS NOT NULL THEN 'matterEvent' ELSE 'firmEvent' END AS event_kind, ` +
  `matter_event_type.name AS event_type_name ` +
  `FROM ${FIRM_RESOURCE_BOOKING_TABLE} ` +
  `LEFT JOIN matter_event ON matter_event.id = ${FIRM_RESOURCE_BOOKING_TABLE}.matter_event_id ` +
  `LEFT JOIN firm_event ON firm_event.id = ${FIRM_RESOURCE_BOOKING_TABLE}.firm_event_id ` +
  `LEFT JOIN matter_event_type ON matter_event_type.id = COALESCE(matter_event.event_type_id, firm_event.event_type_id) `;

export function insertFirmResourceBookingStatement(
  database: SqlDatabase,
  input: {
    readonly id: FirmResourceBookingId;
    readonly resourceId: FirmResourceId;
    readonly matterEventId: MatterEventId | null;
    readonly firmEventId: FirmEventId | null;
    readonly startsOn: string;
    readonly startsAtTime: string | null;
    readonly endsOn: string | null;
    readonly endsAtTime: string | null;
    readonly timeZone: string;
    readonly recordedAt: string;
    readonly recordedBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FIRM_RESOURCE_BOOKING_TABLE} (${BOOKING_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
    )
    .bind(
      input.id,
      input.resourceId,
      input.matterEventId,
      input.firmEventId,
      input.startsOn,
      input.startsAtTime,
      input.endsOn,
      input.endsAtTime,
      input.timeZone,
      input.recordedAt,
      input.recordedBy,
      input.now,
    );
}

// The window is editable per booking (the setup-time case) and NEVER silently re-derived from the
// event afterward; the zone moves only through the explicit-override path.
export function updateFirmResourceBookingStatement(
  database: SqlDatabase,
  id: FirmResourceBookingId,
  patch: {
    readonly startsOn: string;
    readonly startsAtTime: string | null;
    readonly endsOn: string | null;
    readonly endsAtTime: string | null;
    readonly timeZone: string;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FIRM_RESOURCE_BOOKING_TABLE} SET starts_on = ?2, starts_at_time = ?3, ends_on = ?4, ` +
        `ends_at_time = ?5, time_zone = ?6, updated_at = ?7 WHERE id = ?1`,
    )
    .bind(
      id,
      patch.startsOn,
      patch.startsAtTime,
      patch.endsOn,
      patch.endsAtTime,
      patch.timeZone,
      updatedAt,
    );
}

// A true delete: a booking is a claim on a room, not history — the event it served is the record.
export function deleteFirmResourceBookingStatement(
  database: SqlDatabase,
  id: FirmResourceBookingId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${FIRM_RESOURCE_BOOKING_TABLE} WHERE id = ?1`).bind(id);
}

export function selectFirmResourceBookingStatement(
  database: SqlDatabase,
  id: FirmResourceBookingId,
): SqlStatement {
  return database
    .prepare(`${LIVE_BOOKING_SELECT}WHERE ${FIRM_RESOURCE_BOOKING_TABLE}.id = ?1`)
    .bind(id);
}

export async function readFirmResourceBooking(
  database: SqlDatabase,
  id: FirmResourceBookingId,
): Promise<LiveBookingRow | undefined> {
  const { results } = await selectFirmResourceBookingStatement(database, id).all<LiveBookingRow>();
  return results[0];
}

// The availability read's one statement, and the overlap check's coarse stage: a resource's LIVE
// bookings whose civil-date range intersects the window. Liveness is derived in the SQL
// (event_status <> 'cancelled'), rows are bounded by one resource's window, and the civil-date
// comparison is zone-insensitive to within a day — which is what the caller's one-day widening
// absorbs before the precise per-zone comparison runs in application code.
export function selectLiveBookingsInWindowStatement(
  database: SqlDatabase,
  options: {
    readonly resourceId: FirmResourceId;
    readonly fromDate: string;
    readonly toDate: string;
    readonly limit: number;
  },
): SqlStatement {
  return database
    .prepare(
      `${LIVE_BOOKING_SELECT}WHERE ${FIRM_RESOURCE_BOOKING_TABLE}.resource_id = ?1 ` +
        `AND ${FIRM_RESOURCE_BOOKING_TABLE}.starts_on <= ?3 ` +
        `AND COALESCE(${FIRM_RESOURCE_BOOKING_TABLE}.ends_on, ${FIRM_RESOURCE_BOOKING_TABLE}.starts_on) >= ?2 ` +
        `AND COALESCE(matter_event.status, firm_event.status) <> 'cancelled' ` +
        `ORDER BY ${FIRM_RESOURCE_BOOKING_TABLE}.starts_on ASC, ${FIRM_RESOURCE_BOOKING_TABLE}.id ASC LIMIT ?4`,
    )
    .bind(options.resourceId, options.fromDate, options.toDate, options.limit);
}

export async function readLiveBookingsInWindow(
  database: SqlDatabase,
  options: {
    readonly resourceId: FirmResourceId;
    readonly fromDate: string;
    readonly toDate: string;
    readonly limit: number;
  },
): Promise<LiveBookingRow[]> {
  const { results } = await selectLiveBookingsInWindowStatement(
    database,
    options,
  ).all<LiveBookingRow>();
  return results;
}

// The bookings an event holds — what a continuance response reports as released, and what an event
// card embeds. Liveness joined for the same reason as everywhere else.
export function selectBookingsForEventStatement(
  database: SqlDatabase,
  event: { readonly matterEventId: MatterEventId } | { readonly firmEventId: FirmEventId },
): SqlStatement {
  const column = "matterEventId" in event ? "matter_event_id" : "firm_event_id";
  const id = "matterEventId" in event ? event.matterEventId : event.firmEventId;
  return database
    .prepare(
      `${LIVE_BOOKING_SELECT}WHERE ${FIRM_RESOURCE_BOOKING_TABLE}.${column} = ?1 ` +
        `ORDER BY ${FIRM_RESOURCE_BOOKING_TABLE}.starts_on ASC, ${FIRM_RESOURCE_BOOKING_TABLE}.id ASC`,
    )
    .bind(id);
}

export async function readBookingsForEvent(
  database: SqlDatabase,
  event: { readonly matterEventId: MatterEventId } | { readonly firmEventId: FirmEventId },
): Promise<LiveBookingRow[]> {
  const { results } = await selectBookingsForEventStatement(database, event).all<LiveBookingRow>();
  return results;
}
