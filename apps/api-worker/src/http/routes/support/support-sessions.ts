import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import {
  redeemSupportGrantStatement,
  selectPlatformStaffStatement,
  selectSupportGrantStatement,
  type PlatformStaffRow,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  decideIdempotency,
  type IdempotencyRecordRow,
} from "@magna-carta/data-access/idempotency-decision";
import { selectIdempotencyRecordStatement } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { requireChokepointIdempotency } from "../../chokepoint/context-accessors.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import {
  problemResponseForIdempotencyConflict,
  storedResponseBody,
} from "../../idempotency-conflict-problems.ts";
import { platformAdminGuard } from "../shared/platform-admin-guard.ts";
import { supportGrantUsable } from "../../../support/grant-lifecycle.ts";
import { mintSupportSessionToken } from "../../../support/support-session-token.ts";

const RedeemBody = z
  .object({ grantId: z.string(), principalId: z.string() })
  .openapi("RedeemSupportSession");

const RedeemResult = z
  .object({
    token: z.string(),
    tier: z.enum(["diagnostic", "privileged"]),
    firmId: z.string(),
    expiresAt: z.string(),
  })
  .openapi("SupportSessionMinted");

// The platform-admin-gated redeem surface: no firm session (the staff principal authenticates via
// the platform-admin key guard, not a cookie). The chokepoint skips session/firm/RBAC gates for
// `surface: "public"` and applies only the idempotency and rate-limit gates; the platformAdminGuard
// runs before the chokepoint as route-specific middleware (see firms.ts for the composed order).
export const redeemSessionMeta: RouteMeta = {
  operationId: "supportSessions.redeem",
  surface: "public",
  authenticated: true,
  permission: "support:mintSession",
  resource: "firm",
  audited: true,
  idempotency: "required",
  rateLimit: "auth",
};

export const redeemSessionRoute = defineOpenAPIRoute(redeemSessionMeta, {
  method: "post",
  path: "/api/v1/support/sessions",
  description:
    "A platform-staff principal redeems an active support grant for a short-lived support-session " +
    "token. The token encodes the grant, principal, firm, and tier; the live grant row (checked on " +
    "every subsequent request) remains the source of truth for revocation and expiry. Privileged " +
    "grants may only be redeemed by a support_lead principal.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: RedeemBody } }, required: true },
  },
  responses: {
    201: {
      description: "The minted support-session token",
      content: { "application/json": { schema: RedeemResult } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "Missing or invalid X-Platform-Admin-Key",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description:
        "Principal may not redeem this tier (privileged grants require support_lead role)",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "No redeemable grant (absent, not active, or expired), or unknown/disabled principal",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The body failed validation",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerSupportSessionsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...redeemSessionRoute,
      middleware: chokepointMiddleware(chokepoint, redeemSessionRoute, [
        platformAdminGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { grantId, principalId } = c.req.valid("json");
      const now = new Date().toISOString();
      const idempotency = requireChokepointIdempotency(c);

      // Replay-first: check for a committed idempotency record BEFORE running any business
      // pre-checks. A same-key retry returns the stored 201 without re-checking the grant or
      // principal — so a retry after a grant is later revoked replays the original successful
      // mint rather than 404-ing. The chokepoint middleware does the same pre-decision, but this
      // in-handler check closes the narrow window between the middleware's read and the handler's
      // execution, and is the single-use enforcement gate (see principal_id guard below).
      const existingRecord = (
        await selectIdempotencyRecordStatement(
          c.env.DB_CONTROL,
          idempotency.key,
        ).all<IdempotencyRecordRow>()
      ).results[0];
      const replayDecision = decideIdempotency(existingRecord, idempotency.fingerprint);
      switch (replayDecision.kind) {
        case "in-progress":
        case "fingerprint-mismatch":
          return problemResponseForIdempotencyConflict(c, replayDecision);
        case "replay":
          c.header("Idempotency-Replayed", "true");
          return c.json(
            JSON.parse(
              storedResponseBody({
                kind: "replayed" as const,
                responseCode: replayDecision.responseCode,
                responseBody: replayDecision.responseBody,
              }),
            ) as z.infer<typeof RedeemResult>,
            201,
          );
        // case "execute": no record — proceed to business pre-checks below.
      }

      // Pre-condition guards: denied requests are not stored idempotent effects — they return
      // directly so a retry with the same Idempotency-Key re-evaluates the current state.
      const grant = (
        await selectSupportGrantStatement(c.env.DB_CONTROL, grantId as never).all<SupportGrantRow>()
      ).results[0];
      if (grant === undefined || !supportGrantUsable(grant, now)) {
        return problemJson(c, { type: "not-found", status: 404, title: "No redeemable grant" });
      }
      // Single-use enforcement: once any principal redeems a grant, further new-key redeems are
      // refused. Same-key retries are handled by replay-first above and never reach this check.
      if (grant.principal_id !== null) {
        return problemJson(c, { type: "not-found", status: 404, title: "No redeemable grant" });
      }

      const principal = (
        await selectPlatformStaffStatement(
          c.env.DB_CONTROL,
          principalId as never,
        ).all<PlatformStaffRow>()
      ).results[0];
      if (principal === undefined || principal.status !== "active") {
        return problemJson(c, { type: "not-found", status: 404, title: "Unknown principal" });
      }

      if (grant.tier === "privileged" && principal.role !== "support_lead") {
        return problemJson(c, {
          type: "permission-denied",
          status: 403,
          title: "Principal may not redeem a privileged grant",
          detail: "Only a support_lead principal may redeem a privileged grant.",
        });
      }

      // The successful mint runs inside runIdempotentEffect so the redeem update, the audit row,
      // and the idempotency record all commit atomically. A retry with the same Idempotency-Key
      // replays the stored 201 + token without re-executing any mutations.
      const result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        effect: async () => {
          const token = await mintSupportSessionToken(c.env.AUTH_SECRET, {
            grantId: grant.id,
            principalId: principal.id,
            firmId: grant.firm_id,
            requesterUserId: grant.requested_by_user_id,
            tier: grant.tier,
            exp: Math.floor(Date.parse(grant.expires_at) / 1000),
          });
          return {
            write: {
              statements: [
                redeemSupportGrantStatement(c.env.DB_CONTROL, {
                  id: grant.id,
                  principalId: principal.id,
                  firmId: grant.firm_id,
                }),
                insertAuthAuditStatement(c.env.DB_CONTROL, {
                  id: newIdentifier("authAudit"),
                  event: "support.grant.redeemed",
                  userId: grant.requested_by_user_id,
                  metadata: {
                    grantId: grant.id,
                    principalId: principal.id,
                    firmId: grant.firm_id,
                    tier: grant.tier,
                  },
                  now,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 201,
            responseBody: canonicalJsonStringify({
              token,
              tier: grant.tier,
              firmId: grant.firm_id,
              expiresAt: grant.expires_at,
            }),
          };
        },
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      if (result.kind === "replayed") {
        c.header("Idempotency-Replayed", "true");
      }

      const responseBody = JSON.parse(storedResponseBody(result)) as z.infer<typeof RedeemResult>;
      return c.json(responseBody, 201);
    },
  );
}
