import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  readSearchIndexingEnabled,
  searchIndexingEnabledDefinition,
} from "@magna-carta/search/settings";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../../bindings.ts";
import { enqueueFirmIndexBacklog } from "../../../search/index-backlog.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { runInBackground } from "../../deferred-work.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The firm's search settings: one decision today, whether the words inside the firm's files are
// indexed. It is the only writer of the setting the ingest path reads before it enqueues a file for
// indexing and that a matter's search reads before it asks the index anything, so until this route
// existed every firm's file contents stayed unindexed whatever the deployment was ready for. The
// default is defined beside the setting (@magna-carta/search/settings), so a fresh firm reads back
// "off" without a settings row.

const FirmSearchSettingsResponse = z
  .object({
    // Whether the contents of the firm's files are indexed. While it is off no file is read for
    // indexing and a search answers from names alone.
    fileContentsIndexed: z.boolean(),
    // Whether this deployment has a search service to index with. Read-only, and a fact about the
    // platform rather than the firm: a firm may turn indexing on before the service is connected,
    // and the page has to be able to say that nothing is searchable yet for that reason.
    searchServiceConnected: z.boolean(),
  })
  .openapi("FirmSearchSettingsResponse");

const PatchFirmSearchSettingsRequest = z
  .object({ fileContentsIndexed: z.boolean().optional() })
  .openapi("PatchFirmSearchSettingsRequest");

type FirmSearchSettingsBody = z.infer<typeof FirmSearchSettingsResponse>;

const PERMISSION = "firm:manageSearchSettings" as const;

// How much of a firm's existing files one switch-on starts straight away. The daily repair pass
// (background/search/reextraction-sweep.ts) is what draws in a whole back catalogue; this is only so
// that the first files are being read while the person who turned indexing on is still there to look,
// instead of after the next daily pass. Small because it runs on the tail of one request: every
// candidate is a handful of calls to the firm's database and one to a coordinator, and a request's
// background work has neither a queue consumer's time nor its call budget.
const SWITCH_ON_BACKLOG_BUDGET = { enqueueCap: 100, scanCeiling: 200, pageSize: 100 } as const;

const getMeta: RouteMeta = {
  operationId: "firmSearchSettings.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmSearchSettings.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const errorResponses = {
  400: {
    description: "The Idempotency-Key header is missing on a write",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:manageSearchSettings",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is already in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request body is invalid, or the Idempotency-Key was reused with a different body",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/search-settings",
  description:
    "The firm's search settings: whether the contents of its files are indexed, and whether this deployment has a search service to index with.",
  responses: {
    200: {
      description: "The firm's search settings, resolved with their defaults",
      content: { "application/json": { schema: FirmSearchSettingsResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/search-settings",
  description:
    "Updates the firm's search settings. Only the supplied fields change; the change is audited. Turning file indexing on starts reading the firm's existing files.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: PatchFirmSearchSettingsRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's search settings after the change",
      content: { "application/json": { schema: FirmSearchSettingsResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type SearchSettingsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerFirmSearchSettingsRoutes(
  app: SearchSettingsApp,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body: FirmSearchSettingsBody = {
        fileContentsIndexed: await readSearchIndexingEnabled(firm.firmDatabase),
        searchServiceConnected: c.env.SEARCH_SERVICE !== undefined,
      };
      return c.json(body, 200);
    },
  );

  // Only the supplied field is written, and an empty patch is a no-op that writes no audit row, so a
  // redelivered no-op never adds a decision to the log that nobody made. The write and the audit row
  // ride one idempotent batch keyed on the client's Idempotency-Key.
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const searchServiceConnected = c.env.SEARCH_SERVICE !== undefined;
      const current = await readSearchIndexingEnabled(firm.firmDatabase);
      const fileContentsIndexed = body.fileContentsIndexed;
      if (fileContentsIndexed === undefined) {
        const unchanged: FirmSearchSettingsBody = {
          fileContentsIndexed: current,
          searchServiceConnected,
        };
        return c.json(unchanged, 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      // The whole answer, composed here rather than re-read: a read inside the effect would not yet
      // see its own uncommitted write, and a replayed delivery is answered from this record.
      const answer: FirmSearchSettingsBody = { fileContentsIndexed, searchServiceConnected };
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const timestamp = now();
          return {
            write: {
              statements: [
                writeFirmSettingStatement(
                  firm.firmDatabase,
                  searchIndexingEnabledDefinition,
                  fileContentsIndexed,
                  timestamp,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.search_settings_updated",
                  actorUserId: userId,
                  subjectId: null,
                  // The patch as submitted: one boolean, nothing a person typed.
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify(answer),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");

      // Off to on, and only the request that made the change: start on the files the firm already
      // holds. Off the response path, bounded, and best-effort — the daily repair pass draws in
      // everything this does not reach, and would have drawn in all of it had this never run. A
      // replay starts nothing, because the first delivery already did.
      if (result.kind === "executed" && fileContentsIndexed && !current) {
        runInBackground(
          c,
          enqueueFirmIndexBacklog(c.env, firmId, firm.firmDatabase, SWITCH_ON_BACKLOG_BUDGET).catch(
            (caught: unknown) => {
              logOperationFailed(
                createWorkersLogger(c.env.TELEMETRY),
                "firmSearchSettings.startBacklog",
                caught,
              );
            },
          ),
        );
      }

      return c.json(answer, 200);
    },
  );
}
