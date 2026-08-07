import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import {
  appendCursorPredicateOnColumn,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NotificationCategory, NotificationRecipientState } from "./types.ts";
import { MAX_FEED_PAGE_SIZE } from "./types.ts";
import {
  NOTIFICATION_EVENT_TABLE,
  NOTIFICATION_RECIPIENT_TABLE,
  NOTIFICATION_SWEPT_UNREAD_TABLE,
} from "./statements.ts";

// THE ONE PLACE a member's visible notifications are resolved. The feed page, the unread count, and
// the digest read all compose their WHERE clause from `visibleNotificationScope` below — so "the
// digest respects the wall" names ONE implementation rather than two that can drift.
//
// THE WALL BINDS AT DELIVERY TIME, not at emission. Access changes after a notification is raised:
// a member removed from a matter on Tuesday must stop seeing Monday's notifications about it on
// Tuesday, and a member ADDED to a matter should see what is still live. Enforcing at emission
// produces neither — it produces a recipient set frozen at the moment of the event, plus a
// revocation sweep that has to be perfect forever. Nothing here ever deletes or rewrites a row
// because access changed; rows are filtered, and become visible again if access returns.
//
// THE PREDICATE IS COMPOSED IN SQL, BEFORE THE LIMIT, and is a REQUIRED argument rather than an
// optional one with a default. A post-filter in the Worker would under-fill the page (a page of
// fifty returns eleven), make the next cursor mean something different from page to page, and turn
// the page size into an existence oracle for the rows it removed. A required argument makes
// forgetting it a type error first and a fitness failure second, rather than a review comment
// nobody makes.
//
// EVERY READ IS SCOPED TO THE SESSION'S USER, never to a path parameter — the bulk-download
// precedent. A member cannot reach another member's feed by handing over a handle.

export interface VisibleNotificationScope {
  readonly recipientUserId: string;
  // REQUIRED. See the header.
  readonly visibility: VisibleMatterPredicate;
  readonly category?: NotificationCategory;
  readonly state?: NotificationRecipientState;
}

// The FROM and the WHERE every notification read shares. Returned rather than inlined so the count
// and the page cannot answer different questions: a count that included rows the page filters out
// would be a badge telling a member how many things they are not allowed to see.
function visibleNotificationScope(scope: VisibleNotificationScope): {
  readonly from: string;
  readonly conditions: string[];
  readonly bindings: unknown[];
} {
  const conditions: string[] = [`${NOTIFICATION_RECIPIENT_TABLE}.recipient_user_id = ?`];
  const bindings: unknown[] = [scope.recipientUserId];

  // A firm-scoped notification has no matter anchor and is therefore not behind the wall — it is
  // about the firm, and there is no matter whose visibility could decide it. A matter-anchored one
  // is decided entirely by the predicate. Writing the two arms here rather than per read is what
  // keeps a firm-scoped kind from silently vanishing when somebody adds a join.
  conditions.push(
    `(${NOTIFICATION_EVENT_TABLE}.matter_id IS NULL OR ${scope.visibility.fragmentFor(
      `${NOTIFICATION_EVENT_TABLE}.matter_id`,
    )})`,
  );
  bindings.push(...scope.visibility.bindings);

  if (scope.category !== undefined) {
    conditions.push(`${NOTIFICATION_EVENT_TABLE}.category = ?`);
    bindings.push(scope.category);
  }
  if (scope.state !== undefined) {
    conditions.push(`${NOTIFICATION_RECIPIENT_TABLE}.state = ?`);
    bindings.push(scope.state);
  }

  return {
    from: `${NOTIFICATION_RECIPIENT_TABLE} JOIN ${NOTIFICATION_EVENT_TABLE} ON ${NOTIFICATION_EVENT_TABLE}.id = ${NOTIFICATION_RECIPIENT_TABLE}.notification_event_id`,
    conditions,
    bindings,
  };
}

// The raw shape one feed row comes back as. Deliberately narrow: identifiers, closed labels,
// instants, the declared facts blob, and the matter NUMBER — resolved by the same join that
// enforces the wall, so it costs nothing and cannot be stale. No title, no client name, no
// filename: the card is assembled from these and the deep link resolves the rest through the owning
// subsystem's own access-checked read.
export interface NotificationFeedRawRow {
  readonly id: string;
  readonly created_at: string;
  readonly state: string;
  readonly read_at: string | null;
  readonly dismissed_at: string | null;
  readonly kind: string;
  readonly category: string;
  readonly severity: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly matter_id: string | null;
  readonly matter_number: string | null;
  readonly occurred_at: string;
  readonly facts: string | null;
}

// One page, newest first, keyset-paginated. Reads pageSize + 1 so the caller can tell "there is
// more" from "that is all" without a second count — the same over-read the calendar's merge uses.
export function selectNotificationFeedStatement(
  database: SqlDatabase,
  scope: VisibleNotificationScope,
  options: { readonly cursor: SortCursor | undefined; readonly pageSize: number },
): SqlStatement {
  const { from, conditions, bindings } = visibleNotificationScope(scope);
  appendCursorPredicateOnColumn(conditions, bindings, options.cursor, {
    sortColumn: `${NOTIFICATION_RECIPIENT_TABLE}.created_at`,
    idColumn: `${NOTIFICATION_RECIPIENT_TABLE}.id`,
    ascending: false,
  });
  const pageSize = Math.min(Math.max(options.pageSize, 1), MAX_FEED_PAGE_SIZE);
  bindings.push(pageSize + 1);
  return database
    .prepare(
      `SELECT ${NOTIFICATION_RECIPIENT_TABLE}.id AS id, ${NOTIFICATION_RECIPIENT_TABLE}.created_at AS created_at, ${NOTIFICATION_RECIPIENT_TABLE}.state AS state, ${NOTIFICATION_RECIPIENT_TABLE}.read_at AS read_at, ${NOTIFICATION_RECIPIENT_TABLE}.dismissed_at AS dismissed_at, ` +
        `${NOTIFICATION_EVENT_TABLE}.kind AS kind, ${NOTIFICATION_EVENT_TABLE}.category AS category, ${NOTIFICATION_EVENT_TABLE}.severity AS severity, ${NOTIFICATION_EVENT_TABLE}.subject_kind AS subject_kind, ${NOTIFICATION_EVENT_TABLE}.subject_id AS subject_id, ${NOTIFICATION_EVENT_TABLE}.matter_id AS matter_id, ${NOTIFICATION_EVENT_TABLE}.occurred_at AS occurred_at, ${NOTIFICATION_EVENT_TABLE}.facts AS facts, ` +
        // The matter number rides the visibility join rather than a second one: the wall already
        // proved this matter is one the reader may see, so naming it costs nothing extra and
        // cannot disagree with the record the way a stored copy would.
        `(SELECT matter.matter_number FROM matter WHERE matter.id = ${NOTIFICATION_EVENT_TABLE}.matter_id) AS matter_number ` +
        `FROM ${from} WHERE ${conditions.join(" AND ")} ORDER BY ${NOTIFICATION_RECIPIENT_TABLE}.created_at DESC, ${NOTIFICATION_RECIPIENT_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

// The cheap poll. The SAME scope as the page, with the state pinned to unread — a count that
// counted rows the page filters out would tell a member how many things they cannot see, which is
// the exact existence oracle the 404-not-403 posture exists to prevent.
export function selectUnreadNotificationCountStatement(
  database: SqlDatabase,
  scope: Omit<VisibleNotificationScope, "state">,
): SqlStatement {
  const { from, conditions, bindings } = visibleNotificationScope({ ...scope, state: "unread" });
  return database
    .prepare(`SELECT COUNT(*) AS unread_count FROM ${from} WHERE ${conditions.join(" AND ")}`)
    .bind(...bindings);
}

// What the retention sweep took from this member while it was still unread. Read beside the live
// count and reported beside it, never folded into it: they are different facts — one is work
// waiting, the other is work that aged out — and adding them would produce a number that means
// neither.
export function selectSweptUnreadStatement(
  database: SqlDatabase,
  recipientUserId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT unread_count, oldest_swept_occurred_at, last_swept_at FROM ${NOTIFICATION_SWEPT_UNREAD_TABLE} WHERE recipient_user_id = ?1`,
    )
    .bind(recipientUserId);
}

// Resolves ONE of the member's own recipient rows, under the same wall. Used by mark-read and
// dismiss to answer "does this exist for you" without leaking that it exists for somebody else: a
// row belonging to another member, or one whose matter this member cannot see, is simply not found,
// and the route answers 404 rather than 403.
export function selectOwnNotificationStatement(
  database: SqlDatabase,
  scope: Omit<VisibleNotificationScope, "category" | "state">,
  notificationRecipientId: string,
): SqlStatement {
  const { from, conditions, bindings } = visibleNotificationScope(scope);
  conditions.push(`${NOTIFICATION_RECIPIENT_TABLE}.id = ?`);
  bindings.push(notificationRecipientId);
  return database
    .prepare(
      `SELECT ${NOTIFICATION_RECIPIENT_TABLE}.id AS id, ${NOTIFICATION_RECIPIENT_TABLE}.state AS state, ${NOTIFICATION_RECIPIENT_TABLE}.created_at AS created_at FROM ${from} WHERE ${conditions.join(" AND ")} LIMIT 1`,
    )
    .bind(...bindings);
}
