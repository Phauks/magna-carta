import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { INTEGRATION_CONNECTION_TABLE } from "@magna-carta/data-access/integration-connection-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  CALENDAR_SYNC_SHOWN_CALENDAR_TABLE,
  EXTERNAL_CALENDAR_EVENT_TABLE,
  type ExternalEventWindow,
} from "./sync-shown-statements.ts";

// WHEN A MEMBER IS BUSY, FOR A COLLEAGUE, AND NOTHING ELSE ABOUT IT.
//
// The one read of a member's own events that is not by their own connection. What keeps it safe is
// what it selects and what it joins: only the hours, never a title, a place, an identifier or the
// calendar it came from; and only events from a calendar that member chose to share as busy
// (share_busy on their shown-calendar row), in an account still connected. A member who has
// turned nothing on has no row here to read.

export interface BusyTimeRow {
  readonly whole_day: number;
  readonly starts_on: string | null;
  readonly ends_on: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
}

// One member's busy hours that touch a window, earliest first. `limit` is one more than the caller
// will answer with, so it can say there were more.
export function selectMemberBusyTimeStatement(
  database: SqlDatabase,
  memberUserId: UserId,
  window: ExternalEventWindow,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT event.whole_day AS whole_day, event.starts_on AS starts_on, event.ends_on AS ends_on, event.starts_at AS starts_at, event.ends_at AS ends_at FROM ${EXTERNAL_CALENDAR_EVENT_TABLE} AS event JOIN ${CALENDAR_SYNC_SHOWN_CALENDAR_TABLE} AS shown ON shown.connection_id = event.connection_id AND shown.calendar_remote_id = event.calendar_remote_id JOIN ${INTEGRATION_CONNECTION_TABLE} AS connection ON connection.id = event.connection_id WHERE connection.category = 'calendar-sync' AND connection.principal_ref = ?1 AND connection.status = 'connected' AND shown.share_busy = 1 AND ((event.whole_day = 1 AND event.starts_on <= ?3 AND event.ends_on >= ?2) OR (event.whole_day = 0 AND event.starts_at < ?5 AND event.ends_at >= ?4)) ORDER BY COALESCE(event.starts_at, event.starts_on), COALESCE(event.ends_at, event.ends_on) LIMIT ?6`,
    )
    .bind(memberUserId, window.from, window.to, window.fromInstant, window.toInstant, limit);
}
