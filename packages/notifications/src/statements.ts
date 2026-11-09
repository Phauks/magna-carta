import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { Materialization } from "./materialize.ts";

// The write side. Table names are tracked against @magna-carta/database's per-firm schema by the
// schema-name-sync fitness test, so a rename there fails here rather than at runtime.
export const NOTIFICATION_EVENT_TABLE = "notification_event";
export const NOTIFICATION_RECIPIENT_TABLE = "notification_recipient";
export const NOTIFICATION_DELIVERY_TABLE = "notification_delivery";
export const NOTIFICATION_DIGEST_RUN_TABLE = "notification_digest_run";
export const NOTIFICATION_SWEPT_UNREAD_TABLE = "notification_swept_unread";

// IDEMPOTENCY IS A CONSTRAINT, NOT A CHECK-THEN-INSERT.
//
// Queues are at-least-once and sweeps overlap, so a duplicate is the ordinary case rather than the
// exceptional one. Both production paths converge on the same floor: the insert is attempted and
// `ON CONFLICT DO NOTHING` lets the unique index refuse the duplicate inside the same batch. A read
// that asked "does this exist yet" would have its own race between the read and the write, and
// would need a transaction D1 does not offer to close it.
//
// The recipient insert takes the same treatment for a different reason: a fan-out that failed
// halfway and is retried must TOP UP the recipients it missed without duplicating the ones it
// already wrote, which is exactly what a per-(event, recipient) conflict clause does.
export function insertNotificationStatements(
  database: SqlDatabase,
  materialization: Materialization,
): readonly SqlStatement[] {
  const { event, recipients } = materialization;
  const statements: SqlStatement[] = [
    database
      .prepare(
        `INSERT INTO ${NOTIFICATION_EVENT_TABLE} (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .bind(
        event.id,
        event.kind,
        event.category,
        event.severity,
        event.subjectKind,
        event.subjectId,
        event.matterId,
        event.occurredAt,
        // Canonical JSON so the stored form is stable — the same discipline the outbox payload and
        // the idempotency fingerprint take, and the reason two identical fact sets compare equal.
        // Null rather than "{}" when a type declares no facts: an absent slot and an empty object
        // are the same fact, and storing one shape means a reader never has to know both.
        Object.keys(event.facts).length === 0 ? null : canonicalJsonStringify(event.facts),
        event.dedupeKey,
        event.createdAt,
      ),
  ];
  for (const recipient of recipients) {
    statements.push(
      database
        .prepare(
          // The event id is re-resolved through the dedupe key rather than taken from the row above.
          // Batch statements cannot share a JavaScript-side result, and on a REDELIVERY the event
          // insert above is a no-op — so the id this materialization minted is not the id that is
          // actually stored. Selecting by the dedupe key inside the insert is what makes the top-up
          // land on the ORIGINAL event instead of writing recipients pointing at a row that does
          // not exist. The same subselect runs sequentially inside the batch's transaction, so it
          // sees the insert above whether that insert was the winner or the loser.
          `INSERT INTO ${NOTIFICATION_RECIPIENT_TABLE} (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) SELECT ?1, ${NOTIFICATION_EVENT_TABLE}.id, ?2, 'unread', NULL, NULL, ?3 FROM ${NOTIFICATION_EVENT_TABLE} WHERE ${NOTIFICATION_EVENT_TABLE}.dedupe_key = ?4 ON CONFLICT(notification_event_id, recipient_user_id) DO NOTHING`,
        )
        .bind(recipient.id, recipient.recipientUserId, recipient.createdAt, event.dedupeKey),
    );
  }
  return statements;
}

// Marking one item. Guarded on the CURRENT state rather than blind, so a second call changes
// nothing and the route can answer identically both times — which is what "idempotent" means for a
// route with no idempotency key. Also guarded on the recipient's own user id: a member can never
// settle another member's row by handing over its handle.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function markNotificationReadStatement(
  database: SqlDatabase,
  options: {
    readonly notificationRecipientId: string;
    readonly recipientUserId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NOTIFICATION_RECIPIENT_TABLE} SET state = 'read', read_at = ?3, dismissed_at = NULL WHERE id = ?1 AND recipient_user_id = ?2 AND state = 'unread'`,
    )
    .bind(options.notificationRecipientId, options.recipientUserId, options.now);
}

// Dismissing is reachable from any state, unlike reading: a member may dismiss something they have
// already read, and "I have dealt with this" is a different statement from "I have seen it".
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function dismissNotificationStatement(
  database: SqlDatabase,
  options: {
    readonly notificationRecipientId: string;
    readonly recipientUserId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NOTIFICATION_RECIPIENT_TABLE} SET state = 'dismissed', dismissed_at = ?3, read_at = NULL WHERE id = ?1 AND recipient_user_id = ?2 AND state <> 'dismissed'`,
    )
    .bind(options.notificationRecipientId, options.recipientUserId, options.now);
}

// Restoring undoes a dismissal and nothing else. The row comes back READ rather than unread: the
// member dismissed it, so they had already dealt with it, and putting it back on the badge would
// count it as waiting for them a second time.
// fitness:unguarded-write — the caller runs this on its own and branches on the affected-row count, so a refusal is already surfaced there
export function restoreNotificationStatement(
  database: SqlDatabase,
  options: {
    readonly notificationRecipientId: string;
    readonly recipientUserId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NOTIFICATION_RECIPIENT_TABLE} SET state = 'read', read_at = ?3, dismissed_at = NULL WHERE id = ?1 AND recipient_user_id = ?2 AND state = 'dismissed'`,
    )
    .bind(options.notificationRecipientId, options.recipientUserId, options.now);
}

// "Mark everything I have seen as read", BOUNDED BY A CURSOR the caller hands back from a page it
// actually rendered. Two things that bound buys:
//
//   * it cannot silently clear items that arrived after the page was drawn — the member is saying
//     "these", not "whatever is there when this lands";
//   * it cannot become an unbounded UPDATE over a member's whole history.
//
// The bound is the same (created_at, id) keyset the feed page walks, so "everything at or before
// where I had read to" is expressed in exactly the terms the page already speaks.
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function markNotificationsReadThroughStatement(
  database: SqlDatabase,
  options: {
    readonly recipientUserId: string;
    readonly throughCreatedAt: string;
    readonly throughId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NOTIFICATION_RECIPIENT_TABLE} SET state = 'read', read_at = ?4, dismissed_at = NULL WHERE recipient_user_id = ?1 AND state = 'unread' AND (created_at < ?2 OR (created_at = ?2 AND id <= ?3))`,
    )
    .bind(options.recipientUserId, options.throughCreatedAt, options.throughId, options.now);
}

// Clearing the aged-out tally rides the same act. The tally is by construction older than every
// live row a page can show, so a cursor-bounded "I have dealt with what I had seen" covers it —
// and leaving it behind would mean a member who read everything still carried a badge they had no
// way to clear.
export function clearSweptUnreadStatement(
  database: SqlDatabase,
  options: { readonly recipientUserId: string; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NOTIFICATION_SWEPT_UNREAD_TABLE} SET unread_count = 0, oldest_swept_occurred_at = NULL, last_swept_at = ?2 WHERE recipient_user_id = ?1`,
    )
    .bind(options.recipientUserId, options.now);
}
