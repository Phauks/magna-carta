import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
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
import {
  authorizersDefinition,
  readTrustComplianceReportPolicy,
  TRUST_COMPLIANCE_LISTING_VALUES,
  zeroBalanceLedgersDefinition,
} from "../../reporting/trust-compliance-report-policy.ts";

// THE FIRM'S REPORT POLICY — what the firm decides once about what its own reports list, kept apart
// from the reports themselves, which only read.
//
// Two settings today, both about the trust-compliance document: whether a matter ledger at zero all
// period appears, and whether the member who authorized each payment out is named. They sit behind
// `firm:manageReportPolicy` (Owner/Admin by seed) rather than any `reports:` key, for a reason the
// conformance suite enforces: no `reports:` key may ever gate a write, so a report can never adjust
// the books it reports on. Deciding what the document says is the firm's act; reading the document
// is the reader's, and the pack route reads the policy on the reader's behalf.

const PERMISSION = "firm:manageReportPolicy" as const;

const ListingEnum = z.enum(TRUST_COMPLIANCE_LISTING_VALUES).openapi("TrustComplianceListing");

const FirmReportPolicyResponse = z
  .object({
    trustCompliance: z.object({
      zeroBalanceLedgers: ListingEnum,
      authorizers: ListingEnum,
    }),
  })
  .openapi("FirmReportPolicyResponse");

const PatchFirmReportPolicyRequest = z
  .object({
    // Sparse: a field absent is unchanged, and an empty patch writes nothing and audits nothing.
    trustCompliance: z
      .object({
        zeroBalanceLedgers: ListingEnum.optional(),
        authorizers: ListingEnum.optional(),
      })
      .optional(),
  })
  .openapi("PatchFirmReportPolicyRequest");

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
    description: "The session member lacks firm:manageReportPolicy",
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

const getMeta: RouteMeta = {
  operationId: "firmReportPolicy.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmReportPolicy.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited: the policy decides what the firm's compliance document says to an examiner, and a
  // later "why does this pack not name the authorizer" turns on who changed it and when. The
  // metadata is the policy itself, two closed enums; nothing a person typed.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/reports/policy",
  description:
    "Reads the firm's report policy: what its trust-compliance document lists. Whether a matter " +
    "ledger that was at zero throughout the period appears, and whether the member who authorized " +
    "each payment out of a client ledger is named. Both default to listed and named; the pack reads " +
    "this policy for every report it produces, so the firm's document reads the same every time.",
  responses: {
    200: {
      description: "The firm's report policy",
      content: { "application/json": { schema: FirmReportPolicyResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/reports/policy",
  description:
    "Updates the firm's report policy. Sparse: an absent field is left alone, and an empty patch " +
    "changes nothing and records nothing. Returns the policy after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchFirmReportPolicyRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's report policy after the write",
      content: { "application/json": { schema: FirmReportPolicyResponse } },
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

type PolicyApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type PolicyBody = z.infer<typeof FirmReportPolicyResponse>;
type FirmDatabase = Parameters<typeof readTrustComplianceReportPolicy>[0];

async function readPolicyBody(database: FirmDatabase): Promise<PolicyBody> {
  return { trustCompliance: await readTrustComplianceReportPolicy(database) };
}

export function registerFirmReportPolicyRoutes(app: PolicyApp, chokepoint: Chokepoint): void {
  // GET /api/v1/firm/reports/policy
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readPolicyBody(firm.firmDatabase), 200);
    },
  );

  // PATCH /api/v1/firm/reports/policy
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const zeroBalanceLedgers = body.trustCompliance?.zeroBalanceLedgers;
      const authorizers = body.trustCompliance?.authorizers;
      if (zeroBalanceLedgers === undefined && authorizers === undefined) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a policy change in the log that nobody made.
        return c.json(await readPolicyBody(firm.firmDatabase), 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const stored = await readTrustComplianceReportPolicy(firm.firmDatabase);
      const merged: PolicyBody = {
        trustCompliance: {
          zeroBalanceLedgers: zeroBalanceLedgers ?? stored.zeroBalanceLedgers,
          authorizers: authorizers ?? stored.authorizers,
        },
      };

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
                ...(zeroBalanceLedgers === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        zeroBalanceLedgersDefinition,
                        zeroBalanceLedgers,
                        timestamp,
                      ),
                    ]),
                ...(authorizers === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        authorizersDefinition,
                        authorizers,
                        timestamp,
                      ),
                    ]),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.report_policy_updated",
                  actorUserId,
                  subjectId: null,
                  // The patch as submitted: two closed enums, nothing a person typed.
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            // Composed from the merged value rather than re-read: a read inside this effect would
            // not yet see its own uncommitted write.
            responseBody: canonicalJsonStringify(merged),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(await readPolicyBody(firm.firmDatabase), 200);
    },
  );
}
