import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import {
  autoFileDirectFilingDefinition,
  readAutoFileDirectFilingPermitted,
} from "../emails/auto-file-policy.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// The firm's ceiling on unattended email filing. One switch, off until an administrator turns it on;
// the resolved value is read here and by the capture consumer through the same helper, so the queue
// path and the API can never disagree about what the firm chose.

const AutoFilePolicyResponse = z
  .object({ directFilingPermitted: z.boolean() })
  .openapi("AutoFilePolicyResponse");

const PatchAutoFilePolicyRequest = z
  .object({ directFilingPermitted: z.boolean().optional() })
  .openapi("PatchAutoFilePolicyRequest");

// The administrative lane the firm catch-all already sits in: deciding whether the platform may file
// mail with nobody present is the same kind of act as minting the address that mail arrives on, and
// both bind the firm rather than any one matter. Deliberately NOT the capability that lets a member
// configure a rule — a member may not opt their firm into unattended filing.
const PERMISSION = "emails:manageCaptureAddresses" as const;

const getMeta: RouteMeta = {
  operationId: "emails.getAutoFilePolicy",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "emails.updateAutoFilePolicy",
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
    description: "The session member lacks emails:manageCaptureAddresses",
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
  path: "/api/v1/firm/email-auto-file-policy",
  description:
    "Reads whether the firm permits captured email to be filed onto a matter without a person " +
    "present. The setting is off for a firm that has never changed it, so a fresh firm always " +
    "reads a valid configuration.",
  responses: {
    200: {
      description: "The firm's automatic-filing policy",
      content: { "application/json": { schema: AutoFilePolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/email-auto-file-policy",
  description:
    "Sets whether the firm permits captured email to be filed onto a matter without a person " +
    "present. This is a ceiling, not a default: while it is off, a rule that asks to file still " +
    "only places the message on the matter for someone to confirm. Turning it on does not file " +
    "anything that has already been captured. Only the supplied fields are changed; the write is " +
    "batched atomically with an audit entry.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: PatchAutoFilePolicyRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The updated automatic-filing policy",
      content: { "application/json": { schema: AutoFilePolicyResponse } },
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

export function registerAutoFilePolicyRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(
        { directFilingPermitted: await readAutoFileDirectFilingPermitted(firm.firmDatabase) },
        200,
      );
    },
  );

  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");

      const current = await readAutoFileDirectFilingPermitted(firm.firmDatabase);
      // An empty patch is a no-op: the current state back, with no write and no audit row, so a
      // redelivered no-op never adds a spurious entry to the firm's record.
      if (body.directFilingPermitted === undefined) {
        return c.json({ directFilingPermitted: current }, 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = (): string => new Date().toISOString();
      const resolved = { directFilingPermitted: body.directFilingPermitted };

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
                  autoFileDirectFilingDefinition,
                  body.directFilingPermitted ?? current,
                  timestamp,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "emails.auto_file_policy_updated",
                  actorUserId: userId,
                  subjectId: null,
                  metadata: resolved,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify(resolved),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof AutoFilePolicyResponse>,
        200,
      );
    },
  );
}
