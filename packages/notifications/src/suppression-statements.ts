import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { InAppSuppressionReason, NotificationCategory } from "./types.ts";

// MAKING A SUPPRESSION OBSERVABLE.
//
// The failure mode of any preference system is silence: something that should have reached somebody
// did not, and nothing records that a choice is the reason. Afterwards "nobody was told" and "this
// person asked not to be told" look identical, and only one of them is a bug — so the platform can
// neither reassure a member nor find a delivery fault.
//
// So a suppressed in-app notification is an absent FEED row plus a counted row here. What is
// deliberately NOT here: the event, the subject, the matter, the kind. A per-item record of what
// somebody declined to hear would be a second feed holding exactly the pointers they asked not to be
// given, and it would outlive the access check that justified the notification. A member, a closed
// category label, a civil day, a reason, and a count answer what a support conversation actually
// asks, and nothing more.
//
// Table name tracked against @magna-carta/database's per-firm schema by the constraint suite in
// test/schema-constraints.test.ts, which writes these statements against the real migrated lineage.
export const NOTIFICATION_IN_APP_SUPPRESSION_TABLE = "notification_in_app_suppression";

export interface InAppSuppressionTally {
  readonly recipientUserId: string;
  readonly category: NotificationCategory;
  readonly reason: InAppSuppressionReason;
  // The platform's civil day the fan-out ran on — `civilDateOf(now)` at the caller, which holds the
  // clock this package does not.
  readonly civilDate: string;
  readonly suppressedCount: number;
  readonly now: string;
}

// Accumulating rather than replacing: a day's fan-outs suppress in many separate passes, and each
// adds to what that day's choice cost rather than overwriting it. The same reasoning the swept-unread
// tally takes, and the same conflict clause shape.
export function recordInAppSuppressionStatement(
  database: SqlDatabase,
  tally: InAppSuppressionTally,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NOTIFICATION_IN_APP_SUPPRESSION_TABLE} (recipient_user_id, category, civil_date, suppressed_count, reason, last_suppressed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ` +
        `ON CONFLICT(recipient_user_id, category, civil_date, reason) DO UPDATE SET suppressed_count = suppressed_count + excluded.suppressed_count, last_suppressed_at = excluded.last_suppressed_at`,
    )
    .bind(
      tally.recipientUserId,
      tally.category,
      tally.civilDate,
      tally.suppressedCount,
      tally.reason,
      tally.now,
    );
}

// One suppression fact a caller reports as a counter point: both dimensions are closed labels, and
// there is deliberately no member, no kind, and no subject among them — a telemetry dimension whose
// cardinality tracks firm data is the one thing this subsystem's counters may never carry. How many
// people rides the value.
export interface InAppSuppressionCount {
  readonly category: NotificationCategory;
  readonly reason: InAppSuppressionReason;
  readonly count: number;
}

// The statements and the counter points for one event's suppressed recipients, built together so a
// caller cannot record the durable tally and forget the counter, or the other way round. One
// statement per suppressed member: the accumulate in the conflict clause is what collapses a day's
// worth of them into one row.
export function inAppSuppressionEffects(
  database: SqlDatabase,
  options: {
    readonly category: NotificationCategory;
    readonly suppressed: readonly {
      readonly recipientUserId: string;
      readonly reason: InAppSuppressionReason;
    }[];
    readonly now: string;
  },
): {
  readonly statements: readonly SqlStatement[];
  readonly counts: readonly InAppSuppressionCount[];
} {
  const civilDate = civilDateOf(options.now);
  const byReason = new Map<InAppSuppressionReason, number>();
  const statements = options.suppressed.map((entry) => {
    byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
    return recordInAppSuppressionStatement(database, {
      recipientUserId: entry.recipientUserId,
      category: options.category,
      reason: entry.reason,
      civilDate,
      suppressedCount: 1,
      now: options.now,
    });
  });
  return {
    statements,
    counts: [...byReason].map(([reason, count]) => ({ category: options.category, reason, count })),
  };
}

export interface InAppSuppressionRawRow {
  readonly category: string;
  readonly reason: string;
  readonly suppressed_count: number;
  readonly last_suppressed_at: string;
}

// What one member's own settings have stopped since a civil date, per category and reason. Scoped to
// the ASKING member and never to a path parameter, the same rule every read in this subsystem takes:
// how much somebody has chosen not to hear is their own fact, not a colleague's to look up.
//
// No LIMIT and none needed: the row count is bounded by categories times reasons times the days in
// the window, and the window is the firm's retention setting, which is capped.
export function selectInAppSuppressionStatement(
  database: SqlDatabase,
  recipientUserId: string,
  sinceCivilDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT category, reason, SUM(suppressed_count) AS suppressed_count, MAX(last_suppressed_at) AS last_suppressed_at ` +
        `FROM ${NOTIFICATION_IN_APP_SUPPRESSION_TABLE} WHERE recipient_user_id = ?1 AND civil_date >= ?2 ` +
        `GROUP BY category, reason ORDER BY category, reason`,
    )
    .bind(recipientUserId, sinceCivilDate);
}
