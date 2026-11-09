import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  assemblePage,
  decodeCursor,
  encodeCursor,
  DEFAULT_PAGE_SIZE,
} from "@magna-carta/data-access/cursor-pagination";
import {
  selectNotificationFeedStatement,
  selectOwnNotificationStatement,
  selectSweptUnreadStatement,
  selectUnreadNotificationCountStatement,
  type NotificationFeedRawRow,
} from "@magna-carta/notifications/read-statements";
import {
  clearSweptUnreadStatement,
  dismissNotificationStatement,
  markNotificationReadStatement,
  markNotificationsReadThroughStatement,
} from "@magna-carta/notifications/statements";
import { notificationTypeForKey } from "@magna-carta/notifications/registry";
import {
  MAX_FEED_PAGE_SIZE,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_RECIPIENT_STATES,
  type NotificationRecipientState,
} from "@magna-carta/notifications/types";
import { identifierField } from "@magna-carta/identifiers/field";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// A member's own notification feed. FIVE reads and writes, every one of them scoped to the
// SESSION's user id and never to a path parameter — a member can never reach another member's feed
// by handing over a handle, which is the bulk-download precedent.
//
// Every read composes the visible-matter predicate in SQL before the LIMIT, through the one shared
// resolver in @magna-carta/notifications/read-statements. That is what makes the feed page and the
// unread count answer the SAME question: a count including rows the page filters out would be a
// badge telling a member how many things they are not allowed to see.
//
// A notification carries no string a person typed. The card below is assembled from the kind, the
// closed labels, the declared facts, and the matter NUMBER resolved by the same join that enforces
// the wall — never from a stored title, which would be stale the moment a matter was renumbered and
// would outlive the access check that justified writing it. The subject resolves when the member
// follows the deep link, through the owning subsystem's own access-checked read.

const READ = "notifications:read" as const;

const NotificationCategoryEnum = z.enum(NOTIFICATION_CATEGORIES);
const NotificationStateEnum = z.enum(NOTIFICATION_RECIPIENT_STATES);

const NotificationItem = z
  .object({
    id: z.string(),
    kind: z.string(),
    category: NotificationCategoryEnum,
    severity: z.enum(["informational", "attention", "critical"]),
    state: NotificationStateEnum,
    subjectKind: z.string(),
    subjectId: z.string(),
    matterId: z.string().nullable(),
    // The firm's own number for the matter, resolved at read time through the visibility join. Not
    // the title: a matter title is client-identifying by construction, because firms name matters
    // after the parties and the dispute.
    matterNumber: z.string().nullable(),
    occurredAt: z.string(),
    createdAt: z.string(),
    readAt: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    // The declared non-privileged slot: identifiers, integers, booleans, declared enum labels, and
    // dates. A registered type cannot declare a free-text field.
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
    link: z.string(),
  })
  .openapi("NotificationItem");

// The feed page carries ONE field beyond the uniform envelope: a cursor naming the NEWEST row it
// returned. `nextCursor` cannot serve here — it names the page's oldest row and is null at the end
// of the record, which is exactly the common case of a member with one page of notifications.
// Without this field a client has only two ways to offer "mark all read": mint the cursor itself,
// which puts the cursor's encoding in a second place and guarantees the two drift, or fire one
// request per visible row, which is neither atomic nor able to clear the aged-out tally. So the
// route that mints cursors hands this one back too.
const NotificationPage = paginated(NotificationItem)
  .extend({
    readThroughCursor: z.string().nullable(),
  })
  .openapi("NotificationPage");

const UnreadCountResponse = z
  .object({
    unreadCount: z.number().int(),
    // What the retention sweep took from this member while it was still unread. Reported BESIDE the
    // live count and never folded into it: they are different facts — one is work waiting, the
    // other is work that aged out — and adding them would produce a number that means neither.
    // Surfaced rather than dropped because "there is nothing to see" is a claim the platform is not
    // in a position to make about a member who was away; what the swept pointers pointed at (the
    // matter timeline, the deadline, the audit log) is all still there.
    sweptUnreadCount: z.number().int(),
    sweptUnreadOldestOccurredAt: z.string().nullable(),
  })
  .openapi("NotificationUnreadCountResponse");

const MarkReadResponse = z
  .object({ id: z.string(), state: NotificationStateEnum })
  .openapi("NotificationMarkResponse");

const MarkAllReadRequest = z
  .object({
    // The cursor from a page the caller actually rendered. REQUIRED, and the reason is not
    // ceremony: without it "mark all read" would silently clear items that arrived after the page
    // was drawn — the member is saying "these", not "whatever is there when this lands" — and it
    // would become an unbounded UPDATE over a member's whole history.
    throughCursor: z.string(),
  })
  .openapi("NotificationMarkAllReadRequest");

const MarkAllReadResponse = z
  .object({
    // What the badge now says, re-read under the same visibility filter. Reported instead of "how
    // many did I just clear" because that is the number the caller actually needs and the one this
    // route can answer honestly: a driver-reported changed-row count is not uniform across the
    // batch adapters this runs on, and inventing a plausible number would be worse than not
    // offering one.
    remainingUnreadCount: z.number().int(),
  })
  .openapi("NotificationMarkAllReadResponse");

const notificationErrorResponses = {
  400: {
    description: "The cursor is not one this API minted",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks notifications:read",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No such notification for this member",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The category filter names no registered category",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const listMeta: RouteMeta = {
  operationId: "notifications.list",
  surface: "app",
  authenticated: true,
  permission: READ,
  // The firm, not the matter: a feed spans every matter a member touches AND firm-scoped kinds that
  // have no matter at all, so binding it to "matter" would name a resource half the rows lack.
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

/*
 * A repeated query parameter arrives as a string when it was sent once and an array when it was
 * sent several times, and a caller that sent it none of the times sends undefined. One reading, so
 * no handler has to remember the three-way shape.
 */
function asList<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as T];
}

/*
 * The ceiling on how many kinds one search may name. The client derives them from its own registry,
 * so in practice this is never reached — it bounds a HAND-WRITTEN request, which is the only way an
 * unbounded IN list could be composed here.
 */
const MAX_SEARCH_KINDS = 200;

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/notifications",
  description:
    "Returns one page of the session member's own notifications, newest first and cursor-paginated. " +
    "Rows are scoped to the calling member and filtered by matter visibility at read time rather than " +
    "when they were written, so a change in what a matter's notifications may show takes effect on the " +
    "next read without any row being altered; today that filter excludes the platform's own internal " +
    "holding matters, and any further restriction composes into the same read when it exists. " +
    "A notification carries identifiers, closed labels, counts and dates only — never a title, a name, " +
    "a filename or a subject line; follow the link to resolve the record it points at through that " +
    "subsystem's own access-checked read. " +
    "readThroughCursor names the newest row on this page and is what read-all takes as its bound; " +
    "it is null only when the page is empty. " +
    "Searching has an unusual shape here, and it follows from the row carrying no sentence: the " +
    "words a member reads are composed by the client from the kind and the declared facts, so the " +
    "client resolves a query into the `kinds` and `searchCategories` whose words match it and " +
    "sends those alongside `search`, which is matched against the matter number — the one piece of " +
    "member-facing text the row itself carries. The three are OR-ed; supplying none of them " +
    "narrows nothing, and an empty `kinds` means the query matched no kind rather than matching " +
    "no row.",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      category: NotificationCategoryEnum.optional(),
      state: NotificationStateEnum.optional(),
      // Repeated query parameters, so `?kinds=a&kinds=b`. Capped at the registry's own size: a
      // caller cannot ask for more kinds than exist, and the bound is what keeps a hand-written
      // request from composing an unbounded IN list.
      kinds: z.union([z.string(), z.array(z.string())]).optional(),
      searchCategories: z
        .union([NotificationCategoryEnum, z.array(NotificationCategoryEnum)])
        .optional(),
      search: z.string().max(200).optional(),
      pageSize: z.coerce.number().int().min(1).max(MAX_FEED_PAGE_SIZE).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of the member's notifications",
      content: { "application/json": { schema: NotificationPage } },
    },
    401: notificationErrorResponses[401],
    403: notificationErrorResponses[403],
    // The category refusal. A cursor this API did not mint is NOT an error here — it is treated as
    // the first page, which is the platform's cursor contract and is harmless for a read. The
    // read-all route is the one place that reading would be wrong, and it declares a 400.
    422: notificationErrorResponses[422],
    429: notificationErrorResponses[429],
  },
});

const unreadCountMeta: RouteMeta = {
  operationId: "notifications.unreadCount",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const unreadCountRoute = defineOpenAPIRoute(unreadCountMeta, {
  method: "get",
  path: "/api/v1/notifications/unread-count",
  description:
    "Returns the session member's unread count under the same visibility filter the feed page applies, " +
    "plus what the retention sweep removed while it was still unread. The two are reported separately " +
    "because they are different facts: one is work waiting, the other is work that aged out of the feed " +
    "while the records it pointed at stayed exactly where they are.",
  responses: {
    200: {
      description: "The member's unread counts",
      content: { "application/json": { schema: UnreadCountResponse } },
    },
    401: notificationErrorResponses[401],
    403: notificationErrorResponses[403],
    429: notificationErrorResponses[429],
  },
});

const notificationIdParam = z.object({
  notificationRecipientId: identifierField("notificationRecipient"),
});

// audited: false, and it is a deliberate exemption rather than an oversight. A mark-read is a
// member's own read receipt on their own feed row: it records nothing about the firm's conduct, it
// is fired once per item cleared, and auditing it would put a row in audit_log every time somebody
// glanced at their badge — flooding the one table a firm actually needs to be able to read. The
// aiDetection.detect precedent, and the exemption is listed by operation id with this reasoning in
// the conformance suite's allow-list rather than being silently absent.
const markReadMeta: RouteMeta = {
  operationId: "notifications.markRead",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const markReadRoute = defineOpenAPIRoute(markReadMeta, {
  method: "post",
  path: "/api/v1/notifications/{notificationRecipientId}/read",
  description:
    "Marks one of the session member's own notifications read. Idempotent: a second call changes nothing " +
    "and returns the same body. A notification belonging to another member, or one the same visibility " +
    "filter keeps off this member's feed, is not found rather than forbidden.",
  request: { params: notificationIdParam },
  responses: {
    200: {
      description: "The notification's settled state",
      content: { "application/json": { schema: MarkReadResponse } },
    },
    401: notificationErrorResponses[401],
    403: notificationErrorResponses[403],
    404: notificationErrorResponses[404],
    429: notificationErrorResponses[429],
  },
});

const dismissMeta: RouteMeta = {
  operationId: "notifications.dismiss",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const dismissRoute = defineOpenAPIRoute(dismissMeta, {
  method: "post",
  path: "/api/v1/notifications/{notificationRecipientId}/dismiss",
  description:
    "Dismisses one of the session member's own notifications, from any state — dealing with something is a " +
    "different statement from having seen it. Idempotent: a second call changes nothing and returns the same body.",
  request: { params: notificationIdParam },
  responses: {
    200: {
      description: "The notification's settled state",
      content: { "application/json": { schema: MarkReadResponse } },
    },
    401: notificationErrorResponses[401],
    403: notificationErrorResponses[403],
    404: notificationErrorResponses[404],
    429: notificationErrorResponses[429],
  },
});

const markAllReadMeta: RouteMeta = {
  operationId: "notifications.markAllRead",
  surface: "app",
  authenticated: true,
  permission: READ,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const markAllReadRoute = defineOpenAPIRoute(markAllReadMeta, {
  method: "post",
  path: "/api/v1/notifications/read-all",
  description:
    "Marks the session member's unread notifications read as far back as a cursor from a page they actually " +
    "read. The cursor is required: it keeps the call from clearing items that arrived after that page was " +
    "drawn, and keeps it from becoming an unbounded update over the member's whole history. It also clears the " +
    "count of notifications that aged out unread, which is the same statement about the same backlog.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: MarkAllReadRequest } },
    },
  },
  responses: {
    200: {
      description: "The member's unread count after the bounded mark",
      content: { "application/json": { schema: MarkAllReadResponse } },
    },
    400: notificationErrorResponses[400],
    401: notificationErrorResponses[401],
    403: notificationErrorResponses[403],
    429: notificationErrorResponses[429],
  },
});

type NotificationsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function parseFacts(raw: string | null): Record<string, string | number | boolean> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string | number | boolean>)
      : null;
  } catch {
    // A stored value that will not parse must never brick a read — the same posture every settings
    // read takes. The card renders from its kind and its matter number, which is most of what it
    // says anyway.
    return null;
  }
}

function notificationView(row: NotificationFeedRawRow): z.infer<typeof NotificationItem> {
  const type = notificationTypeForKey(row.kind);
  return {
    id: row.id,
    kind: row.kind,
    category: row.category as z.infer<typeof NotificationCategoryEnum>,
    severity: row.severity as "informational" | "attention" | "critical",
    state: row.state as z.infer<typeof NotificationStateEnum>,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    matterId: row.matter_id,
    matterNumber: row.matter_number,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
    facts: parseFacts(row.facts),
    // A kind whose type has been retired still renders — as a row pointing at nothing, rather than
    // as a 500 on somebody's whole feed.
    link: type === undefined ? "" : type.deepLink(row.subject_id, row.matter_id),
  };
}

export function registerNotificationsRoutes(app: NotificationsApp, chokepoint: Chokepoint): void {
  // GET /api/v1/notifications
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const query = c.req.valid("query");

      const statement = selectNotificationFeedStatement(
        firm.firmDatabase,
        {
          recipientUserId: sessionUserId,
          // THE WALL. Required argument, composed in SQL before the LIMIT.
          visibility: visibleMatterPredicate(),
          category: query.category,
          state: query.state,
          kinds: asList(query.kinds).slice(0, MAX_SEARCH_KINDS),
          searchCategories: asList(query.searchCategories),
          search: query.search,
        },
        {
          cursor: decodeCursor(query.cursor),
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        },
      );
      const { results } = await statement.all<NotificationFeedRawRow>();
      const page = assemblePage(
        results,
        Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_FEED_PAGE_SIZE),
        notificationView,
      );
      // The head of the page the caller is about to render — the bound `read-all` takes. Read from
      // `results` rather than from the mapped page because the cursor is over the storage sort key,
      // which the view does not carry.
      const newest = results[0];
      return c.json(
        {
          data: [...page.data],
          nextCursor: page.nextCursor,
          readThroughCursor:
            newest === undefined ? null : encodeCursor(newest.created_at, newest.id),
        },
        200,
      );
    },
  );

  // GET /api/v1/notifications/unread-count
  app.openapi(
    { ...unreadCountRoute, middleware: chokepointMiddleware(chokepoint, unreadCountRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);

      const [live, swept] = await Promise.all([
        selectUnreadNotificationCountStatement(firm.firmDatabase, {
          recipientUserId: sessionUserId,
          visibility: visibleMatterPredicate(),
        }).all<{ unread_count: number }>(),
        selectSweptUnreadStatement(firm.firmDatabase, sessionUserId).all<{
          unread_count: number;
          oldest_swept_occurred_at: string | null;
        }>(),
      ]);

      const sweptRow = swept.results[0];
      return c.json(
        {
          unreadCount: live.results[0]?.unread_count ?? 0,
          sweptUnreadCount: sweptRow?.unread_count ?? 0,
          sweptUnreadOldestOccurredAt: sweptRow?.oldest_swept_occurred_at ?? null,
        },
        200,
      );
    },
  );

  // POST /api/v1/notifications/{notificationRecipientId}/read
  app.openapi(
    { ...markReadRoute, middleware: chokepointMiddleware(chokepoint, markReadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const { notificationRecipientId } = c.req.valid("param");
      const now = new Date().toISOString();

      // Resolved under the SAME filter as the feed. A row belonging to somebody else, or one the
      // visibility predicate keeps off this member's feed, is simply not found — 404 and never 403,
      // because a distinguishable 403 tells the caller the row exists.
      const existing = await selectOwnNotificationStatement(
        firm.firmDatabase,
        { recipientUserId: sessionUserId, visibility: visibleMatterPredicate() },
        notificationRecipientId,
      ).all<{ id: string; state: NotificationRecipientState }>();
      const row = existing.results[0];
      if (row === undefined) return notFound(c);

      if (row.state === "unread") {
        await markNotificationReadStatement(firm.firmDatabase, {
          notificationRecipientId,
          recipientUserId: sessionUserId,
          now,
        }).run();
      }
      // Already-read and already-dismissed rows fall straight through: the second call changes
      // nothing and answers with the state that stands, which is what idempotent means for a route
      // with no idempotency key.
      return c.json(
        { id: notificationRecipientId, state: row.state === "unread" ? "read" : row.state },
        200,
      );
    },
  );

  // POST /api/v1/notifications/{notificationRecipientId}/dismiss
  app.openapi(
    { ...dismissRoute, middleware: chokepointMiddleware(chokepoint, dismissRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const { notificationRecipientId } = c.req.valid("param");
      const now = new Date().toISOString();

      const existing = await selectOwnNotificationStatement(
        firm.firmDatabase,
        { recipientUserId: sessionUserId, visibility: visibleMatterPredicate() },
        notificationRecipientId,
      ).all<{ id: string; state: NotificationRecipientState }>();
      const row = existing.results[0];
      if (row === undefined) return notFound(c);

      if (row.state !== "dismissed") {
        await dismissNotificationStatement(firm.firmDatabase, {
          notificationRecipientId,
          recipientUserId: sessionUserId,
          now,
        }).run();
      }
      return c.json({ id: notificationRecipientId, state: "dismissed" as const }, 200);
    },
  );

  // POST /api/v1/notifications/read-all
  app.openapi(
    { ...markAllReadRoute, middleware: chokepointMiddleware(chokepoint, markAllReadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const sessionUserId = requireChokepointUserId(c);
      const { throughCursor } = c.req.valid("json");
      const now = new Date().toISOString();

      const decoded = decodeCursor(throughCursor);
      if (decoded === undefined) {
        // A cursor this API did not mint is refused rather than treated as "the whole feed". The
        // permissive reading of a malformed cursor everywhere else is "the first page", which is
        // harmless for a read; here it would silently mean "everything", which is the opposite of
        // what the bound exists for.
        return problemJson(c, {
          type: "validation",
          title: "Bad Request",
          status: 400,
          detail: "throughCursor is not a cursor this API issued.",
        });
      }

      // Both writes in one batch: marking the live rows and clearing the aged-out tally are one
      // statement by the member ("I have dealt with the backlog I was shown"), and committing them
      // separately would leave a member who crashed in between carrying half of it.
      const statements = [
        markNotificationsReadThroughStatement(firm.firmDatabase, {
          recipientUserId: sessionUserId,
          throughCreatedAt: decoded.createdAt,
          throughId: decoded.id,
          now,
        }),
        clearSweptUnreadStatement(firm.firmDatabase, {
          recipientUserId: sessionUserId,
          now,
        }),
      ];
      await commitEffectBatch(
        firm.firmDatabase,
        { statements, outboxMessages: [] },
        { now: () => now },
      );

      const remaining = await selectUnreadNotificationCountStatement(firm.firmDatabase, {
        recipientUserId: sessionUserId,
        visibility: visibleMatterPredicate(),
      }).all<{ unread_count: number }>();
      return c.json({ remainingUnreadCount: remaining.results[0]?.unread_count ?? 0 }, 200);
    },
  );
}

function notFound(c: Parameters<typeof problemJson>[0]) {
  return problemJson(c, {
    type: "not-found",
    title: "Not Found",
    status: 404,
    detail: "No such notification for this member.",
  });
}
