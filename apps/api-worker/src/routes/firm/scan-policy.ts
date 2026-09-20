import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
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
import { fetchScoreHistogram } from "../../files/score-histogram.ts";
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

// The firm's malware scan-policy settings: the active scan tier, the suspicious-score floor that
// determines how aggressively YARA rule matches are flagged, how a flagged file is treated at
// access time, and the step-up re-auth preference. Defaults are defined in scan-policy-settings.ts
// so a fresh firm reads back correct values without a settings UI or seed row.

const ScanPolicyResponse = z
  .object({
    policy: z.object({
      tier: z.enum(["core", "extended", "full"]),
      suspiciousScoreFloor: z.number().int().min(0).max(100),
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

// The `_SUSP_` score distribution of the deployed scan engine's baked rule corpus — the reference data
// the firm's custom suspicious-score-floor control plots. Engine-global (identical for every firm), so it
// carries no firm data. `engineVersion`/`minScoreGate` are null when no scan engine is deployed (every
// local/test environment, and before the scan worker is wired in production), in which case the control
// renders unbounded rather than erroring.
const ScoreHistogramResponse = z
  .object({
    engineVersion: z.string().nullable(),
    minScoreGate: z.number().int().nullable(),
    total: z.number().int(),
    buckets: z.array(z.object({ floor: z.number().int(), count: z.number().int() })),
  })
  .openapi("ScoreHistogramResponse");

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
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const histogramMeta: RouteMeta = {
  operationId: "scanPolicy.scoreHistogram",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
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
    description: "The session member lacks firm:manageScanPolicy",
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
    headers: idempotencyKeyHeader,
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
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const histogramRoute = defineOpenAPIRoute(histogramMeta, {
  method: "get",
  path: "/api/v1/firm/scan-policy/score-histogram",
  description:
    "Returns the deployed scan engine's heuristic (`_SUSP_`) rule-score distribution as 5-point " +
    "buckets — the reference data for the firm's custom suspicious-score-floor control. The data is " +
    "engine-global (identical for every firm). When no scan engine is deployed, engineVersion and " +
    "minScoreGate are null and buckets is empty.",
  responses: {
    200: {
      description:
        "The scan engine's suspicious-score histogram, or the empty shape when no engine is deployed",
      content: { "application/json": { schema: ScoreHistogramResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
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

  // GET /api/v1/firm/scan-policy/score-histogram — the scan engine's _SUSP_ score distribution, gated
  // like the policy itself. Engine-global data, so it reaches the scan engine over the SCAN_SERVICE
  // binding rather than firm storage. The fetch + no-engine + fault handling lives in fetchScoreHistogram
  // (unit-tested for all three branches); a deployed-but-unreachable engine throws, never a masked empty.
  app.openapi(
    { ...histogramRoute, middleware: chokepointMiddleware(chokepoint, histogramRoute) },
    async (c) => c.json(await fetchScoreHistogram(c.env.SCAN_SERVICE), 200),
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

      // Read the current resolved settings up front. An empty patch (no present fields) is a no-op:
      // return the current state without a write or an audit row, so a redelivered no-op never adds a
      // spurious firm.scan_policy_updated entry. For a real patch these values also seed the response
      // body so the stored idempotent response reflects the full merged state deterministically.
      const [currentPolicy, currentFlaggedTreatment, currentStepUp] = await Promise.all([
        readFirmScanPolicy(firm.firmDatabase),
        readFlaggedTreatment(firm.firmDatabase),
        readStepUpReauthOnFlagged(firm.firmDatabase),
      ]);
      if (
        body.policy === undefined &&
        body.flaggedTreatment === undefined &&
        body.stepUpReauthOnFlagged === undefined
      ) {
        return c.json(
          {
            policy: currentPolicy,
            flaggedTreatment: currentFlaggedTreatment,
            stepUpReauthOnFlagged: currentStepUp,
          },
          200,
        );
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const resolved: z.infer<typeof ScanPolicyResponse> = {
        policy: body.policy ?? currentPolicy,
        flaggedTreatment: body.flaggedTreatment ?? currentFlaggedTreatment,
        stepUpReauthOnFlagged: body.stepUpReauthOnFlagged ?? currentStepUp,
      };

      // The settings writes AND the audit row ride one idempotent batch keyed on the client's
      // Idempotency-Key: a retried or redelivered PATCH replays the stored response instead of writing
      // a duplicate audit row.
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const ts = now();
          const settingStatements = [
            ...(body.policy !== undefined
              ? [
                  writeFirmSettingStatement(
                    firm.firmDatabase,
                    scanPolicyDefinition,
                    body.policy,
                    ts,
                  ),
                ]
              : []),
            ...(body.flaggedTreatment !== undefined
              ? [
                  writeFirmSettingStatement(
                    firm.firmDatabase,
                    flaggedTreatmentDefinition,
                    body.flaggedTreatment,
                    ts,
                  ),
                ]
              : []),
            ...(body.stepUpReauthOnFlagged !== undefined
              ? [
                  writeFirmSettingStatement(
                    firm.firmDatabase,
                    stepUpReauthDefinition,
                    body.stepUpReauthOnFlagged,
                    ts,
                  ),
                ]
              : []),
          ];
          return {
            write: {
              statements: [
                ...settingStatements,
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.scan_policy_updated",
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
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ScanPolicyResponse>,
        200,
      );
    },
  );
}
