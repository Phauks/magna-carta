import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import {
  redeemSupportGrantStatement,
  selectPlatformStaffStatement,
  selectSupportGrantStatement,
  type PlatformStaffRow,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { platformAdminGuard } from "./firms.ts";
import { supportGrantUsable } from "../support/grant-lifecycle.ts";
import { mintSupportSessionToken } from "../support/support-session-token.ts";
import { writeSupportAudit } from "../support/support-audit.ts";

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

      const grant = (
        await selectSupportGrantStatement(c.env.DB_CONTROL, grantId as never).all<SupportGrantRow>()
      ).results[0];
      if (grant === undefined || !supportGrantUsable(grant, now)) {
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

      await redeemSupportGrantStatement(c.env.DB_CONTROL, {
        id: grant.id,
        principalId: principal.id,
      }).run();

      const token = await mintSupportSessionToken(c.env.AUTH_SECRET, {
        grantId: grant.id,
        principalId: principal.id,
        firmId: grant.firm_id,
        requesterUserId: grant.requested_by_user_id,
        tier: grant.tier,
        exp: Math.floor(Date.parse(grant.expires_at) / 1000),
      });

      await writeSupportAudit(c.env.DB_CONTROL, {
        event: "support.grant.redeemed",
        requesterUserId: grant.requested_by_user_id,
        metadata: {
          grantId: grant.id,
          principalId: principal.id,
          firmId: grant.firm_id,
          tier: grant.tier,
        },
        now,
      });

      return c.json(
        { token, tier: grant.tier, firmId: grant.firm_id, expiresAt: grant.expires_at },
        201,
      );
    },
  );
}
