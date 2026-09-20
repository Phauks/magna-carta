import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  readRecordChanges,
  recordChangesDefinition,
} from "@magna-carta/file-manager/editing-policy-settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The firm's editing policy: one setting today, whether every document opened in the browser editor
// records its changes. Read by the WOPI host on every CheckFileInfo (the editor is told to keep
// recording on) and by the launch (the screen framing the editor hides the marks on open). The
// default is defined in editing-policy-settings.ts, so a fresh firm reads back the right value
// without a settings row.

const EditingPolicyResponse = z
  .object({
    // Whether every document opened in the editor records its changes, with the recording control
    // kept out of members' reach. The stored document keeps every mark; a copy that leaves the
    // platform is produced with them accepted.
    recordChanges: z.boolean(),
  })
  .openapi("EditingPolicyResponse");

const PatchEditingPolicyRequest = z
  .object({ recordChanges: z.boolean().optional() })
  .openapi("PatchEditingPolicyRequest");

const PERMISSION = "firm:manageEditingPolicy" as const;

const getMeta: RouteMeta = {
  operationId: "editingPolicy.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "editingPolicy.update",
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
    description: "The session member lacks firm:manageEditingPolicy",
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
  path: "/api/v1/firm/editing-policy",
  description:
    "The firm's editing policy: whether every document opened in the browser editor records its changes.",
  responses: {
    200: {
      description: "The firm's editing policy, resolved with its defaults",
      content: { "application/json": { schema: EditingPolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/editing-policy",
  description:
    "Updates the firm's editing policy. Only the supplied fields change; the change is audited.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: PatchEditingPolicyRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's editing policy after the change",
      content: { "application/json": { schema: EditingPolicyResponse } },
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

type EditingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerEditingPolicyRoutes(app: EditingApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json({ recordChanges: await readRecordChanges(firm.firmDatabase) }, 200);
    },
  );

  // Only the supplied field is written, and an empty patch is a no-op that writes no audit row, so a
  // redelivered no-op never adds a spurious entry. The write and the audit row ride one idempotent
  // batch keyed on the client's Idempotency-Key.
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const current = await readRecordChanges(firm.firmDatabase);
      if (body.recordChanges === undefined) return c.json({ recordChanges: current }, 200);

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const resolved: z.infer<typeof EditingPolicyResponse> = { recordChanges: body.recordChanges };
      const recordChanges = body.recordChanges;
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const ts = now();
          return {
            write: {
              statements: [
                writeFirmSettingStatement(
                  firm.firmDatabase,
                  recordChangesDefinition,
                  recordChanges,
                  ts,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.editing_policy_updated",
                  actorUserId: userId,
                  subjectId: null,
                  metadata: body,
                  now: ts,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify(resolved),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof EditingPolicyResponse>,
        200,
      );
    },
  );
}
