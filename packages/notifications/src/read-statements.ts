import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import {
  appendCursorPredicateOnColumn,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { askableTerm, likePattern, LIKE_ESCAPE_CLAUSE } from "@magna-carta/data-access/like-search";
import type { NotificationCategory, NotificationRecipientState } from "./types.ts";
import { MAX_DIGEST_ITEMS_PER_RUN, MAX_FEED_PAGE_SIZE } from "./types.ts";
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
  /**
   * Several states at once, OR-ed: the feed asks for `unread` and `read` together so a dismissed row
   * stays off it without the page coming back short. Composed with `state` when both are given,
   * which narrows to their overlap rather than widening.
   */
  readonly states?: readonly NotificationRecipientState[];
  /**
   * What a member's search reaches, and it has an unusual shape for a good reason.
   *
   * THERE IS NO SENTENCE IN THIS SUBSYSTEM TO SEARCH. A notification row carries identifiers,
   * closed labels, counts and dates — deliberately, because a stored sentence would outlive the
   * access check that justified writing it and would go stale the moment the matter behind it was
   * renumbered. The words a member actually reads ("Deadline overdue", "A payment failed") are
   * composed in the client from the kind and the declared facts. So a substring scan on this side
   * would be searching `deadlines.deadline.overdue`, which is not what anybody types.
   *
   * The client therefore resolves the query into the KINDS and CATEGORIES whose words match it —
   * it owns those words — and sends them here alongside the raw term, which this matches against
   * the one piece of member-facing text the row does carry: the matter's own number.
   *
   * The three arms are OR-ed, and an empty `kinds` is not "match nothing": it means the query
   * matched no kind's words and the answer rests on the other arms. All three absent is not a
   * search at all, and narrows nothing.
   */
  readonly kinds?: readonly string[];
  readonly searchCategories?: readonly NotificationCategory[];
  /** Matched against the matter number. See `kinds`. */
  readonly search?: string;
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
  const states = scope.states ?? [];
  if (states.length > 0) {
    conditions.push(
      `${NOTIFICATION_RECIPIENT_TABLE}.state IN (${states.map(() => "?").join(", ")})`,
    );
    bindings.push(...states);
  }

  /*
   * The search, as one OR-ed group so it cannot widen the wall above it. Composed here beside the
   * other narrowings rather than in the feed statement, because the FEED and any future count over
   * the same question must not be able to disagree about what a search means — which is the same
   * argument this whole module is built on.
   *
   * The unread badge deliberately does NOT pass a search: it counts what is waiting for a member,
   * which is a fact about their work rather than about the box they last typed in.
   */
  const searchArms: string[] = [];
  const kinds = scope.kinds ?? [];
  if (kinds.length > 0) {
    searchArms.push(`${NOTIFICATION_EVENT_TABLE}.kind IN (${kinds.map(() => "?").join(", ")})`);
    bindings.push(...kinds);
  }
  const searchCategories = scope.searchCategories ?? [];
  if (searchCategories.length > 0) {
    searchArms.push(
      `${NOTIFICATION_EVENT_TABLE}.category IN (${searchCategories.map(() => "?").join(", ")})`,
    );
    bindings.push(...searchCategories);
  }
  const term = askableTerm(scope.search);
  if (term !== undefined) {
    // The matter's number, through the same correlated read the row's own matter_number comes from,
    // so the two can never disagree about which matter a row belongs to.
    searchArms.push(
      `(SELECT matter.matter_number FROM matter WHERE matter.id = ${NOTIFICATION_EVENT_TABLE}.matter_id) LIKE ? ${LIKE_ESCAPE_CLAUSE}`,
    );
    bindings.push(likePattern(term));
  }
  if (searchArms.length > 0) {
    conditions.push(`(${searchArms.join(" OR ")})`);
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
  scope: Omit<VisibleNotificationScope, "state" | "states">,
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

// The watermark one digest run starts after: an instant AND the event id that instant belongs to.
// Never a bare timestamp — two events sharing an instant would straddle a bare-timestamp boundary,
// and one of them would be carried twice or not at all.
export interface DigestWatermark {
  readonly lastOccurredAt: string;
  readonly lastEventId: string;
}

// What one row contributes to a summary. A CATEGORY, an ESCALATION-bearing kind, and the recipient
// row's own handle so the send can be settled against it — and nothing else. There is no title
// column to omit here because there is no title column anywhere in this subsystem; what this
// deliberately does not select is the subject, the matter, and the facts, none of which an email may
// carry and none of which the aggregation needs.
export interface DigestWindowRawRow {
  readonly notification_recipient_id: string;
  readonly kind: string;
  readonly category: string;
  readonly occurred_at: string;
  readonly notification_event_id: string;
}

// THE DIGEST READ, and it is the dangerous one: it runs server-side, on a member's behalf, with no
// request context — exactly where a "we already know who this is for" shortcut gets written. It
// composes its WHERE from `visibleNotificationScope` like the feed and the count do, so "the digest
// respects the wall" names ONE implementation rather than a second that can drift from it.
//
// ASCENDING, unlike the feed. A summary walks forward from where the last one stopped, so the
// watermark it leaves behind is the last row it actually carried; the feed walks backward from now
// because a reader wants the newest first. Same scope, opposite direction, and the ordering pair is
// the event's rather than the recipient row's because the watermark is stored in the event's terms.
//
// No state filter, deliberately. The window is defined by the watermark — "what arrived since we
// last wrote to you" — and filtering out rows the member happened to have already opened would make
// two members with identical queues receive different mail depending on when they looked at the app,
// and would leave the settled set disagreeing with the watermark that claims to cover it.
export function selectDigestWindowStatement(
  database: SqlDatabase,
  scope: Omit<VisibleNotificationScope, "category" | "state">,
  options: { readonly after: DigestWatermark | null; readonly limit: number },
): SqlStatement {
  const { from, conditions, bindings } = visibleNotificationScope(scope);
  if (options.after !== null) {
    // Written out rather than as a row-value comparison so the index walk is legible and the shape
    // matches every other keyset in the platform.
    conditions.push(
      `(${NOTIFICATION_EVENT_TABLE}.occurred_at > ? OR (${NOTIFICATION_EVENT_TABLE}.occurred_at = ? AND ${NOTIFICATION_EVENT_TABLE}.id > ?))`,
    );
    bindings.push(
      options.after.lastOccurredAt,
      options.after.lastOccurredAt,
      options.after.lastEventId,
    );
  }
  // Over-read by one so the caller can tell a full page from a clamped one without a second count.
  // A clamped page is reported as "at least N" rather than as N, which is the only honest reading.
  const limit = Math.min(Math.max(options.limit, 1), MAX_DIGEST_ITEMS_PER_RUN);
  bindings.push(limit + 1);
  return database
    .prepare(
      `SELECT ${NOTIFICATION_RECIPIENT_TABLE}.id AS notification_recipient_id, ${NOTIFICATION_EVENT_TABLE}.kind AS kind, ${NOTIFICATION_EVENT_TABLE}.category AS category, ${NOTIFICATION_EVENT_TABLE}.occurred_at AS occurred_at, ${NOTIFICATION_EVENT_TABLE}.id AS notification_event_id ` +
        `FROM ${from} WHERE ${conditions.join(" AND ")} ORDER BY ${NOTIFICATION_EVENT_TABLE}.occurred_at ASC, ${NOTIFICATION_EVENT_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings);
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
