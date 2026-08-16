import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  NOTIFICATION_DELIVERY_TABLE,
  NOTIFICATION_EVENT_TABLE,
  NOTIFICATION_RECIPIENT_TABLE,
  NOTIFICATION_SWEPT_UNREAD_TABLE,
} from "./statements.ts";
import { NOTIFICATION_IN_APP_SUPPRESSION_TABLE } from "./suppression-statements.ts";

// AGEING A POINTER OUT, honestly.
//
// A notification is a pointer and never a record: the thing it points at — the ledger entry, the
// invoice, the quarantined version, the matter's own lifecycle row, the audit_log entry beside it —
// IS the record, keeps its own retention posture, and is untouched by anything here. That is what
// makes a retention window defensible in this subsystem where the custody register refuses one
// outright: the custodian rule is about a client's irreplaceable property, and this is about a
// badge.
//
// Unread rows age on the same clock as read ones. An unread ninety-day-old notification is not an
// outstanding task; it is evidence that the thing it points at is tracked somewhere else. But
// "nobody needs the pointer" is not the same claim as "nobody missed anything", so the sweep does
// not simply drop what it takes: it TALLIES the unread rows per member first, and the unread count
// reports that tally beside the live one. A member back from three weeks' leave is told that
// eleven things aged out and how far back they reach, and the timeline, the deadline, and the audit
// log they pointed at are all still there to be looked at. Silently returning zero would be the
// platform making a claim — "there is nothing you missed" — that it is not in a position to make.

// How many events one pass removes. Bounded and resumable rather than "delete everything older
// than the cutoff": a firm that has not been swept in a month must not present the nightly pass
// with an unbounded DELETE, and the next pass simply continues where this one stopped.
export const RETENTION_SWEEP_BATCH_SIZE = 500;

export interface RetentionSweepPlan {
  readonly cutoff: string;
  readonly statements: readonly SqlStatement[];
}

// The instant a notification must have occurred before to be swept. Days rather than an instant
// because that is the unit a firm sets and reasons in, computed from the caller's clock so nothing
// here reads one.
export function retentionCutoff(now: string, retentionDays: number): string {
  return new Date(Date.parse(now) - retentionDays * 86_400_000).toISOString();
}

// Reads what one pass would take from each member while it is still unread. Run BEFORE the delete,
// in the same pass, because after the delete the answer is gone — which is precisely the fact this
// whole mechanism exists to keep.
export function selectSweepableUnreadTallyStatement(
  database: SqlDatabase,
  cutoff: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id AS recipient_user_id, COUNT(*) AS unread_count, MIN(${NOTIFICATION_EVENT_TABLE}.occurred_at) AS oldest_occurred_at ` +
        `FROM ${NOTIFICATION_RECIPIENT_TABLE} JOIN ${NOTIFICATION_EVENT_TABLE} ON ${NOTIFICATION_EVENT_TABLE}.id = ${NOTIFICATION_RECIPIENT_TABLE}.notification_event_id ` +
        `WHERE ${NOTIFICATION_RECIPIENT_TABLE}.state = 'unread' AND ${NOTIFICATION_EVENT_TABLE}.id IN (${sweepableEventIds()}) ` +
        `GROUP BY ${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id`,
    )
    .bind(cutoff, RETENTION_SWEEP_BATCH_SIZE);
}

// The bounded selection both the tally and the deletes agree on: the oldest events past the cutoff,
// capped. Spelled once so the tally cannot count a row the delete then leaves behind, or vice
// versa — the two would drift the moment somebody changed one LIMIT.
function sweepableEventIds(): string {
  return `SELECT id FROM ${NOTIFICATION_EVENT_TABLE} WHERE occurred_at < ?1 ORDER BY occurred_at, id LIMIT ?2`;
}

// The tally rows, upserted per member. Accumulating rather than replacing: a member away for two
// months is swept on several nights, and each night's finding adds to what they missed rather than
// overwriting it. The oldest instant only ever moves BACKWARD, because how far back the gap reaches
// is a fact about the whole gap and not about the last pass that touched it.
export function recordSweptUnreadStatement(
  database: SqlDatabase,
  row: {
    readonly recipientUserId: string;
    readonly unreadCount: number;
    readonly oldestOccurredAt: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NOTIFICATION_SWEPT_UNREAD_TABLE} (recipient_user_id, unread_count, oldest_swept_occurred_at, last_swept_at) VALUES (?1, ?2, ?3, ?4) ` +
        `ON CONFLICT(recipient_user_id) DO UPDATE SET unread_count = unread_count + excluded.unread_count, ` +
        `oldest_swept_occurred_at = CASE WHEN ${NOTIFICATION_SWEPT_UNREAD_TABLE}.oldest_swept_occurred_at IS NULL OR excluded.oldest_swept_occurred_at < ${NOTIFICATION_SWEPT_UNREAD_TABLE}.oldest_swept_occurred_at THEN excluded.oldest_swept_occurred_at ELSE ${NOTIFICATION_SWEPT_UNREAD_TABLE}.oldest_swept_occurred_at END, ` +
        `last_swept_at = excluded.last_swept_at`,
    )
    .bind(row.recipientUserId, row.unreadCount, row.oldestOccurredAt, row.now);
}

// The delete, child-first so no statement ever leaves an orphan behind if the batch is inspected
// mid-flight. SQLite has no ON DELETE CASCADE declared on these foreign keys — deliberately, since
// a cascade would make the blast radius of any future delete invisible at the call site — so the
// three deletes are written out and they all name the SAME bounded event selection.
//
// Nothing here touches a source record. That is the property the whole retention posture rests on,
// and it is visible in the statements: every one of them names a notification table.
export function retentionSweepDeleteStatements(
  database: SqlDatabase,
  cutoff: string,
): readonly SqlStatement[] {
  const selection = sweepableEventIds();
  return [
    database
      .prepare(
        `DELETE FROM ${NOTIFICATION_DELIVERY_TABLE} WHERE notification_recipient_id IN (SELECT id FROM ${NOTIFICATION_RECIPIENT_TABLE} WHERE notification_event_id IN (${selection}))`,
      )
      .bind(cutoff, RETENTION_SWEEP_BATCH_SIZE),
    database
      .prepare(
        `DELETE FROM ${NOTIFICATION_RECIPIENT_TABLE} WHERE notification_event_id IN (${selection})`,
      )
      .bind(cutoff, RETENTION_SWEEP_BATCH_SIZE),
    database
      .prepare(`DELETE FROM ${NOTIFICATION_EVENT_TABLE} WHERE id IN (${selection})`)
      .bind(cutoff, RETENTION_SWEEP_BATCH_SIZE),
  ];
}

// The suppression tally ages on the SAME window as the notifications it describes. It is bounded by
// the civil date rather than by the event selection above because it has no event to be bounded by —
// that is the whole point of a tally — so it is a separate, unbounded-in-rows but
// bounded-in-window delete. The row count it can touch is members times categories times reasons
// times the days that fell out of the window on this pass, which is small by construction.
//
// Left standing, it would become a growing record of one member's settings with nothing left to
// compare it against: the feed rows it explains are gone, and a count of what somebody declined to
// hear in a quarter nobody can look at any more answers no question worth keeping it for.
export function retentionSweepSuppressionDeleteStatement(
  database: SqlDatabase,
  cutoff: string,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${NOTIFICATION_IN_APP_SUPPRESSION_TABLE} WHERE civil_date < ?1`)
    .bind(cutoff.slice(0, 10));
}
