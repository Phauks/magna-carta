import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  readFirmScanPolicy,
  readFlaggedTreatment,
  readStepUpReauthOnFlagged,
  scanPolicyDefinition,
  flaggedTreatmentDefinition,
  stepUpReauthDefinition,
} from "@magna-carta/file-manager/scan-policy-settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The firm's malware scan-policy settings: the active scan tier, the suspicious-score floor that
// determines how aggressively YARA rule matches are flagged, how a flagged file is treated at
// access time, and the step-up re-auth preference. Defaults are defined in scan-policy-settings.ts
// so a fresh firm reads back correct values without a settings UI or seed row.

const ScanPolicyResponse = z
  .object({
    policy: z.object({
      tier: z.enum(["core", "extended", "full"]),
      suspiciousScoreFloor: z.number().int(),
    }),
    flaggedTreatment: z.enum(["block", "informed-access", "allow-and-flag"]),
    stepUpReauthOnFlagged: z.boolean(),
  })
  .openapi("ScanPolicyResponse");

const PatchScanPolicyRequest = z
  .object({
    policy: z
      .object({
        tier: z.enum(["core", "extended", "full"]),
        suspiciousScoreFloor: z.number().int().min(0).max(100),
      })
      .optional(),
    flaggedTreatment: z.enum(["block", "informed-access", "allow-and-flag"]).optional(),
    stepUpReauthOnFlagged: z.boolean().optional(),
  })
  .openapi("PatchScanPolicyRequest");

const PERMISSION = "firm:manageScanPolicy" as const;

const getMeta: RouteMeta = {
  operationId: "scanPolicy.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "scanPolicy.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const errorResponses = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:manageScanPolicy",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is invalid",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/scan-policy",
  description:
    "Reads the firm's malware scan-policy settings: the scan tier, suspicious-score floor, " +
    "flagged-file treatment, and step-up re-auth preference. Missing rows return the built-in " +
    "defaults so a fresh firm always reads a valid configuration.",
  responses: {
    200: {
      description: "The firm scan-policy settings",
      content: { "application/json": { schema: ScanPolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/scan-policy",
  description:
    "Updates one or more of the firm's malware scan-policy settings. Only the supplied fields " +
    "are changed; absent fields retain their current values. Writes are batched atomically with " +
    "an audit log entry. Returns the full resolved settings after the update.",
  request: {
    body: {
      content: { "application/json": { schema: PatchScanPolicyRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The updated scan-policy settings",
      content: { "application/json": { schema: ScanPolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type ScanApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerScanPolicyRoutes(app: ScanApp, chokepoint: Chokepoint): void {
  // GET /api/v1/firm/scan-policy — read the firm's scan-policy settings, resolved with defaults.
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const [policy, flaggedTreatment, stepUpReauthOnFlagged] = await Promise.all([
        readFirmScanPolicy(firm.firmDatabase),
        readFlaggedTreatment(firm.firmDatabase),
        readStepUpReauthOnFlagged(firm.firmDatabase),
      ]);
      return c.json({ policy, flaggedTreatment, stepUpReauthOnFlagged }, 200);
    },
  );

  // PATCH /api/v1/firm/scan-policy — update the present fields and audit the change atomically.
  // Only the supplied fields are written; absent fields retain their current stored values.
  // The audit metadata carries the partial update body — policy values only, not file content,
  // so redact-by-default is satisfied.
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const now = new Date().toISOString();

      const settingStatements = [
        ...(body.policy !== undefined
          ? [writeFirmSettingStatement(firm.firmDatabase, scanPolicyDefinition, body.policy, now)]
          : []),
        ...(body.flaggedTreatment !== undefined
          ? [
              writeFirmSettingStatement(
                firm.firmDatabase,
                flaggedTreatmentDefinition,
                body.flaggedTreatment,
                now,
              ),
            ]
          : []),
        ...(body.stepUpReauthOnFlagged !== undefined
          ? [
              writeFirmSettingStatement(
                firm.firmDatabase,
                stepUpReauthDefinition,
                body.stepUpReauthOnFlagged,
                now,
              ),
            ]
          : []),
      ];

      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            ...settingStatements,
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "firm.scan_policy_updated",
              actorUserId: userId,
              subjectId: null,
              metadata: body,
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      // Re-read all three settings so the response reflects the current resolved state.
      const [policy, flaggedTreatment, stepUpReauthOnFlagged] = await Promise.all([
        readFirmScanPolicy(firm.firmDatabase),
        readFlaggedTreatment(firm.firmDatabase),
        readStepUpReauthOnFlagged(firm.firmDatabase),
      ]);
      return c.json({ policy, flaggedTreatment, stepUpReauthOnFlagged }, 200);
    },
  );
}
