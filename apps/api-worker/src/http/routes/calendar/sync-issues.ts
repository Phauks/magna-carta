import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { CalendarSyncIssueList } from "@magna-carta/calendar/sync-contract";
import {
  deleteSyncIssueStatement,
  leaveSyncIssueStatement,
  selectSyncIssueStatement,
  selectSyncIssuesStatement,
  type SyncCopyReading,
  type SyncIssueRow,
} from "@magna-carta/calendar/sync-issue-statements";
import {
  clearSyncLinkAgreementStatement,
  deleteSyncLinkStatement,
  SYNC_LOCAL_KINDS,
  type SyncLinkKey,
} from "@magna-carta/calendar/sync-link-statements";
import { CALENDAR_SYNC_CATEGORY } from "@magna-carta/calendar/sync-port";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { selectConnectionStatement } from "@magna-carta/data-access/integration-connection-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import type { ConnectedAccountsRouteDeps } from "./connected-accounts.ts";

// COPIES A MEMBER CHANGED IN THEIR OWN CALENDAR, AND THE TWO ANSWERS THEY CAN GIVE.
//
// A sync pass raises a question when a copy it wrote no longer reads as it was sent, or is gone.
// These routes list the member's open questions and take one of two answers. "Put back" has the
// copy written again as the firm's calendar has the event. "Leave" keeps the copy as the member
// made it and closes the question. Neither changes anything in the firm's calendar: the event is
// shared, and the copy is the member's own.
//
// Every route finds the account through the session member and nothing a request names, so one
// member can neither read nor answer another's.

const PERMISSION = "calendar:read" as const;

type SyncIssuesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type SyncIssuesContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

const problemContent = { "application/problem+json": { schema: Problem } } as const;

const errorResponses = {
  401: { description: "No valid session", content: problemContent },
  403: { description: "The session member lacks the permission named", content: problemContent },
  404: {
    description:
      "The member has no such open question, or the firm is unreachable or the member deactivated",
    content: problemContent,
  },
  429: { description: "Rate limit exceeded", content: problemContent },
} as const;

const listMeta: RouteMeta = {
  operationId: "calendarSync.listMyIssues",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const answerMeta = (operationId: string): RouteMeta => ({
  operationId,
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
  // An answer to a question that is already answered finds no open question and is refused, so a
  // retry lands nothing twice.
  idempotency: "optional",
  rateLimit: "default",
});

const issueParams = z.object({
  localKind: z.enum(SYNC_LOCAL_KINDS),
  localId: z.string().min(1).max(128),
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/me/calendar-sync/issues",
  description:
    "The copies in the session member's own calendar that no longer match what was sent, or are " +
    "gone, and that the member has not yet answered.",
  responses: {
    200: {
      description: "The member's open questions",
      content: { "application/json": { schema: CalendarSyncIssueList } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const answerResponses = {
  200: {
    description: "The member's open questions after the answer",
    content: { "application/json": { schema: CalendarSyncIssueList } },
  },
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  429: errorResponses[429],
} as const;

const putBackMeta = answerMeta("calendarSync.putBackMyCopy");
const putBackRoute = defineOpenAPIRoute(putBackMeta, {
  method: "post",
  path: "/api/v1/me/calendar-sync/issues/{localKind}/{localId}/put-back",
  description:
    "Has the copy written to the member's calendar again as the firm's calendar has the event: a " +
    "changed copy is overwritten, a deleted one is made again. The firm's event is not changed.",
  request: { params: issueParams },
  responses: answerResponses,
});

const leaveMeta = answerMeta("calendarSync.leaveMyCopy");
const leaveRoute = defineOpenAPIRoute(leaveMeta, {
  method: "post",
  path: "/api/v1/me/calendar-sync/issues/{localKind}/{localId}/leave",
  description:
    "Keeps the copy in the member's calendar as they made it, or leaves it deleted, and closes " +
    "the question. The copy is written again only when the firm's event next changes.",
  request: { params: issueParams },
  responses: answerResponses,
});

function readingOf(text: string): SyncCopyReading {
  return JSON.parse(text) as SyncCopyReading;
}

async function openIssues(database: SqlDatabase, connectionId: IntegrationConnectionId) {
  const rows = await selectSyncIssuesStatement(database, connectionId).all<SyncIssueRow>();
  return rows.results
    .filter((row) => row.state === "open")
    .map((row) => ({
      localKind: row.local_kind,
      localId: row.local_id,
      kind: row.kind,
      sent: readingOf(row.sent_json),
      found: row.found_json === null ? null : readingOf(row.found_json),
      detectedAt: row.detected_at,
    }));
}

export function registerCalendarSyncIssueRoutes(
  app: SyncIssuesApp,
  chokepoint: Chokepoint,
  deps: ConnectedAccountsRouteDeps = {},
): void {
  const now = deps.now ?? (() => new Date());

  async function memberConnectionId(c: SyncIssuesContext): Promise<IntegrationConnectionId | null> {
    const row = await selectConnectionStatement(
      requireChokepointFirmContext(c).firmDatabase,
      CALENDAR_SYNC_CATEGORY,
      requireChokepointUserId(c),
    ).first<{ id: string }>();
    return row === null ? null : (row.id as IntegrationConnectionId);
  }

  // The member's open question for one copy, or null. An answered question is not found: the
  // second of two answers must not undo the first.
  async function openIssue(
    c: SyncIssuesContext,
    params: z.infer<typeof issueParams>,
  ): Promise<{ key: SyncLinkKey; row: SyncIssueRow } | null> {
    const connectionId = await memberConnectionId(c);
    if (connectionId === null) return null;
    const key: SyncLinkKey = {
      connectionId,
      localKind: params.localKind,
      localId: params.localId,
    };
    const row = await selectSyncIssueStatement(
      requireChokepointFirmContext(c).firmDatabase,
      key,
    ).first<SyncIssueRow>();
    return row === null || row.state !== "open" ? null : { key, row };
  }

  const noSuchIssue = (c: SyncIssuesContext) =>
    problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "You have no such open question about a calendar copy. Nothing was changed.",
    });

  // GET /api/v1/me/calendar-sync/issues
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const connectionId = await memberConnectionId(c);
      const database = requireChokepointFirmContext(c).firmDatabase;
      return c.json(
        { issues: connectionId === null ? [] : await openIssues(database, connectionId) },
        200,
      );
    },
  );

  // POST /api/v1/me/calendar-sync/issues/{localKind}/{localId}/put-back
  app.openapi(
    { ...putBackRoute, middleware: chokepointMiddleware(chokepoint, putBackRoute) },
    async (c) => {
      const found = await openIssue(c, c.req.valid("param"));
      if (found === null) return noSuchIssue(c);
      const database = requireChokepointFirmContext(c).firmDatabase;
      const instant = now().toISOString();
      await commitEffectBatch(
        database,
        {
          statements: [
            // A changed copy is overwritten by clearing what was agreed, so the next pass finds the
            // event differs and writes it. A deleted copy has nothing to overwrite: its link goes,
            // and the next pass makes the copy as if it had never been sent.
            found.row.kind === "removed"
              ? deleteSyncLinkStatement(database, found.key)
              : clearSyncLinkAgreementStatement(database, found.key, instant),
            deleteSyncIssueStatement(database, found.key),
            domainAuditStatement(database, {
              event: "calendar_sync.copy_put_back",
              subjectId: found.key.localId,
              actorUserId: requireChokepointUserId(c),
              clock: { now: () => instant },
              metadata: { localKind: found.key.localKind, issue: found.row.kind },
            }),
          ],
          outboxMessages: [],
        },
        { now: () => instant },
      );
      return c.json({ issues: await openIssues(database, found.key.connectionId) }, 200);
    },
  );

  // POST /api/v1/me/calendar-sync/issues/{localKind}/{localId}/leave
  app.openapi(
    { ...leaveRoute, middleware: chokepointMiddleware(chokepoint, leaveRoute) },
    async (c) => {
      const found = await openIssue(c, c.req.valid("param"));
      if (found === null) return noSuchIssue(c);
      const database = requireChokepointFirmContext(c).firmDatabase;
      const instant = now().toISOString();
      await commitEffectBatch(
        database,
        {
          statements: [
            leaveSyncIssueStatement(database, found.key, instant),
            domainAuditStatement(database, {
              event: "calendar_sync.copy_left",
              subjectId: found.key.localId,
              actorUserId: requireChokepointUserId(c),
              clock: { now: () => instant },
              metadata: { localKind: found.key.localKind, issue: found.row.kind },
            }),
          ],
          outboxMessages: [],
        },
        { now: () => instant },
      );
      return c.json({ issues: await openIssues(database, found.key.connectionId) }, 200);
    },
  );
}
