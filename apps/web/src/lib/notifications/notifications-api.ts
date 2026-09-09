/*
 * The member's own notification FEED. Mirrors the `notifications.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * The preference matrix is NOT here. Its transport is ./preferences-api.ts and the words for a
 * category are ./category-vocabulary.ts, both of which the settings screen already reads — one home
 * per fact, so a category renamed for a reader is renamed once.
 *
 * EVERY READ HERE IS THE SESSION'S OWN. None of these calls takes a member handle, because none of
 * the routes does: a feed is resolved from the session and never from a path parameter, so there is
 * no shape in this module that could ask for somebody else's notifications.
 *
 * A NOTIFICATION CARRIES NO STRING A PERSON TYPED. The wire gives identifiers, closed labels,
 * counts and dates — never a title, a name, a filename or a subject line. The sentence a member
 * reads is composed on this side from the kind and the declared facts (see
 * ./notification-presentation.ts); the record itself is resolved by following `link`, through the
 * owning subsystem's own access-checked read. That is not a rendering convenience: a stored title
 * would outlive the access check that justified writing the row, and would be stale the moment the
 * matter behind it was renumbered.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import type { NotificationCategory } from "./category-vocabulary.ts";

export type { NotificationCategory };

export type NotificationSeverity = "informational" | "attention" | "critical";
export type NotificationState = "unread" | "read" | "dismissed";

/**
 * One row of the feed. `facts` is the declared non-privileged slot — identifiers, integers,
 * booleans, declared enum labels and dates, and nothing else; a registered type cannot declare a
 * free-text field, which is what makes rendering it safe without inspecting the values.
 */
export interface NotificationItem {
  id: string;
  /** The registered type, e.g. "deadlines.deadline.overdue". A wire contract, permanent once shipped. */
  kind: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  state: NotificationState;
  subjectKind: string;
  subjectId: string;
  matterId: string | null;
  /**
   * The firm's own number for the matter, resolved at read time through the same join that enforces
   * visibility. Never the title: firms name matters after the parties and the dispute.
   */
  matterNumber: string | null;
  occurredAt: string;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  facts: Readonly<Record<string, string | number | boolean>> | null;
  /** Where the record itself is read, behind the owning subsystem's own access gate. */
  link: string;
}

/** What may narrow the feed. Everything is optional; the default is everything, newest first. */
export interface NotificationQuery {
  readonly category?: NotificationCategory;
  readonly state?: NotificationState;
  readonly pageSize?: number;
}

/**
 * One page of the feed, plus the bound `read-all` takes.
 *
 * `readThroughCursor` names the NEWEST row on the page. It is not `nextCursor`, which names the
 * oldest and is null at the end of the record — so a member holding a single page, which is the
 * ordinary case, would have no cursor at all to clear their backlog with.
 */
export interface NotificationPage extends Page<NotificationItem> {
  readThroughCursor: string | null;
}

export function listNotifications(
  fetchImpl: typeof fetch,
  cursor?: string,
  query: NotificationQuery = {},
): Promise<ApiOutcome<NotificationPage>> {
  const parameters = new URLSearchParams();
  if (cursor !== undefined) parameters.set("cursor", cursor);
  if (query.category !== undefined) parameters.set("category", query.category);
  if (query.state !== undefined) parameters.set("state", query.state);
  if (query.pageSize !== undefined) parameters.set("pageSize", String(query.pageSize));
  const search = parameters.toString();
  return requestJson<NotificationPage>(
    fetchImpl,
    `/api/v1/notifications${search === "" ? "" : `?${search}`}`,
  );
}

/**
 * The badge, and what aged out from under it.
 *
 * The two counts are reported side by side and never added together, because they are different
 * facts: one is work waiting, the other is work that aged out of the feed while everything it
 * pointed at — the matter timeline, the deadline, the audit log — stayed exactly where it is. A
 * member back from leave is told there is a gap rather than shown a reassuring zero.
 */
export interface NotificationUnreadCount {
  unreadCount: number;
  sweptUnreadCount: number;
  sweptUnreadOldestOccurredAt: string | null;
}

export function readUnreadNotificationCount(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<NotificationUnreadCount>> {
  return requestJson<NotificationUnreadCount>(fetchImpl, "/api/v1/notifications/unread-count");
}

export interface NotificationMarkResponse {
  id: string;
  state: NotificationState;
}

export function markNotificationRead(
  fetchImpl: typeof fetch,
  notificationRecipientId: string,
): Promise<ApiOutcome<NotificationMarkResponse>> {
  return requestJson<NotificationMarkResponse>(
    fetchImpl,
    `/api/v1/notifications/${encodeURIComponent(notificationRecipientId)}/read`,
    { method: "POST" },
  );
}

export function dismissNotification(
  fetchImpl: typeof fetch,
  notificationRecipientId: string,
): Promise<ApiOutcome<NotificationMarkResponse>> {
  return requestJson<NotificationMarkResponse>(
    fetchImpl,
    `/api/v1/notifications/${encodeURIComponent(notificationRecipientId)}/dismiss`,
    { method: "POST" },
  );
}

/**
 * Clear the backlog as far back as a page the member actually saw.
 *
 * `throughCursor` is required by the route and passed from the page the reader is looking at, not
 * invented here: the member is saying "these", not "whatever is there when this lands", and without
 * the bound the call would silently clear items that arrived after the list was drawn. The response
 * reports what the badge now says rather than how many rows moved — the honest number, re-read
 * under the same visibility filter.
 */
export function markNotificationsReadThrough(
  fetchImpl: typeof fetch,
  throughCursor: string,
): Promise<ApiOutcome<{ remainingUnreadCount: number }>> {
  return requestJson<{ remainingUnreadCount: number }>(
    fetchImpl,
    "/api/v1/notifications/read-all",
    { method: "POST", body: { throughCursor } },
  );
}
