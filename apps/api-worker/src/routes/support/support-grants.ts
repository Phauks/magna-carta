import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  cosignSupportGrantStatement,
  insertSupportGrantStatement,
  revokeSupportGrantStatement,
  selectFirmSupportGrantsStatement,
  selectSupportGrantStatement,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { computeExpiresAt, initialGrantStatus } from "../../support/grant-lifecycle.ts";
import { writeSupportAudit } from "../../support/support-audit.ts";

const RequestGrantBody = z
  .object({
    tier: z.enum(["diagnostic", "privileged"]),
    reason: z.string().max(500).optional(),
  })
  .openapi("RequestSupportGrant");

const GrantSummary = z
  .object({
    id: z.string(),
    tier: z.enum(["diagnostic", "privileged"]),
    status: z.enum(["requested", "active", "revoked", "expired", "closed"]),
    requestedByUserId: z.string(),
    principalId: z.string().nullable(),
    requiresCosign: z.boolean(),
    expiresAt: z.string(),
    createdAt: z.string(),
  })
  .openapi("SupportGrantSummary");

export const requestGrantMeta: RouteMeta = {
  operationId: "supportGrants.request",
  surface: "app",
  authenticated: true,
  permission: "support:request",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const requestGrantRoute = defineOpenAPIRoute(requestGrantMeta, {
  method: "post",
  path: "/api/v1/support/grants",
  description:
    "A firm member requests time-boxed help-desk access to their firm. The request is the consent " +
    "anchor — the requester's identity is the scope, and any staff who redeems the grant acts only " +
    "within the tier the requester chose. A diagnostic grant opens immediately; a privileged grant " +
    "waits for admin co-sign when the firm's co-sign policy is on.",
  request: {
    body: { content: { "application/json": { schema: RequestGrantBody } }, required: true },
  },
  responses: {
    201: {
      description: "The created grant",
      content: { "application/json": { schema: GrantSummary } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks support:request",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable or the member is deactivated — structural absence, never an existence oracle",
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

export const listGrantsMeta: RouteMeta = {
  operationId: "supportGrants.list",
  surface: "app",
  authenticated: true,
  // Any authenticated firm member may see their firm's support grants — the transparency surface.
  // No permission gate beyond session + firm resolution: knowing who has requested help-desk access
  // is not a privileged capability.
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const listGrantsRoute = defineOpenAPIRoute(listGrantsMeta, {
  method: "get",
  path: "/api/v1/support/grants",
  description:
    "The firm's support grants — who requested help, the scope (tier), current status, and the " +
    "staff principal who redeemed it. Ordered newest first. Visible to any authenticated firm member " +
    "so every member can see when help-desk access is or was active on their firm.",
  responses: {
    200: {
      description: "The firm's support grants, newest first",
      content: {
        "application/json": {
          schema: z.object({ grants: z.array(GrantSummary) }).openapi("SupportGrantListResponse"),
        },
      },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable or the member is deactivated — structural absence, never an existence oracle",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const GrantStatusResult = z
  .object({ id: z.string(), status: z.string() })
  .openapi("SupportGrantStatusResult");

export const cosignGrantMeta: RouteMeta = {
  operationId: "supportGrants.cosign",
  surface: "app",
  authenticated: true,
  permission: "support:cosign",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const cosignGrantRoute = defineOpenAPIRoute(cosignGrantMeta, {
  method: "post",
  path: "/api/v1/support/grants/{grantId}/cosign",
  description:
    "An admin co-signs a privileged support grant that firm policy held for approval. " +
    "Moves the grant from requested to active so a platform-staff principal may redeem it.",
  request: { params: z.object({ grantId: z.string() }) },
  responses: {
    200: {
      description: "The grant after co-sign",
      content: { "application/json": { schema: GrantStatusResult } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks support:cosign",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such grant in this firm, or it is not awaiting co-sign",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const revokeGrantMeta: RouteMeta = {
  operationId: "supportGrants.revoke",
  surface: "app",
  authenticated: true,
  permission: "support:manage",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const revokeGrantRoute = defineOpenAPIRoute(revokeGrantMeta, {
  method: "post",
  path: "/api/v1/support/grants/{grantId}/revoke",
  description:
    "An admin revokes a support grant; in-flight support access ends on the next request " +
    "the platform-staff principal makes against the grant-verification middleware.",
  request: { params: z.object({ grantId: z.string() }) },
  responses: {
    200: {
      description: "The grant after revoke",
      content: { "application/json": { schema: GrantStatusResult } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks support:manage",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such grant in this firm, or it is already terminal",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

function toSummary(row: SupportGrantRow) {
  return {
    id: row.id,
    tier: row.tier,
    status: row.status,
    requestedByUserId: row.requested_by_user_id,
    principalId: row.principal_id,
    requiresCosign: row.requires_cosign === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function registerSupportGrantsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...requestGrantRoute, middleware: chokepointMiddleware(chokepoint, requestGrantRoute) },
    async (c) => {
      const requesterUserId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const { tier, reason } = c.req.valid("json");

      // A privileged grant honours the firm's co-sign policy; a diagnostic grant never needs one
      // (diagnostic sessions carry no privileged-content access — the co-sign gate is for the
      // tier that does).
      const firmRow = await c.env.DB_CONTROL.prepare(
        "SELECT support_requires_cosign FROM firm WHERE id = ?1",
      )
        .bind(firmId)
        .first<{ support_requires_cosign: number }>();
      const requiresCosign = tier === "privileged" && (firmRow?.support_requires_cosign ?? 0) === 1;
      const status = initialGrantStatus(requiresCosign);

      const grantId = newIdentifier("supportGrant");
      const now = new Date().toISOString();
      const expiresAt = computeExpiresAt(tier, now);

      await insertSupportGrantStatement(c.env.DB_CONTROL, {
        id: grantId,
        firmId,
        requestedByUserId: requesterUserId,
        tier,
        status,
        reason: reason ?? null,
        requiresCosign,
        expiresAt,
        now,
      }).run();

      await writeSupportAudit(c.env.DB_CONTROL, {
        event: "support.grant.requested",
        requesterUserId,
        metadata: { grantId, firmId, tier, requiresCosign: requiresCosign ? "true" : "false" },
        now,
      });

      return c.json(
        {
          id: grantId,
          tier,
          status,
          requestedByUserId: requesterUserId,
          principalId: null,
          requiresCosign,
          expiresAt,
          createdAt: now,
        },
        201,
      );
    },
  );

  app.openapi(
    { ...listGrantsRoute, middleware: chokepointMiddleware(chokepoint, listGrantsRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const result = await selectFirmSupportGrantsStatement(
        c.env.DB_CONTROL,
        firmId,
      ).all<SupportGrantRow>();
      return c.json({ grants: result.results.map(toSummary) }, 200);
    },
  );

  app.openapi(
    { ...cosignGrantRoute, middleware: chokepointMiddleware(chokepoint, cosignGrantRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const cosignedByUserId = requireChokepointUserId(c);
      const grantId = c.req.valid("param").grantId as never;
      const row = (
        await selectSupportGrantStatement(c.env.DB_CONTROL, grantId).all<SupportGrantRow>()
      ).results[0];
      // Firm mismatch is a 404 — the response must not reveal whether the grant belongs to
      // another firm (no existence oracle across firm boundaries).
      if (row === undefined || row.firm_id !== firmId) {
        return problemJson(c, { type: "not-found", status: 404, title: "Not found" });
      }
      // The guarded UPDATE moves requested→active only when requires_cosign=1 (wrong-state grants
      // return changes === 0, which is also a 404 — callers cannot distinguish state from absence).
      const update = await cosignSupportGrantStatement(c.env.DB_CONTROL, {
        id: grantId,
        cosignedByUserId,
        firmId,
      }).run();
      if (update.meta.changes === 0) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Grant not awaiting co-sign",
        });
      }
      const now = new Date().toISOString();
      await writeSupportAudit(c.env.DB_CONTROL, {
        event: "support.grant.cosigned",
        requesterUserId: row.requested_by_user_id,
        metadata: { grantId, firmId, cosignedByUserId },
        now,
      });
      return c.json({ id: grantId, status: "active" } as z.infer<typeof GrantStatusResult>, 200);
    },
  );

  app.openapi(
    { ...revokeGrantRoute, middleware: chokepointMiddleware(chokepoint, revokeGrantRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const actingUserId = requireChokepointUserId(c);
      const grantId = c.req.valid("param").grantId as never;
      const row = (
        await selectSupportGrantStatement(c.env.DB_CONTROL, grantId).all<SupportGrantRow>()
      ).results[0];
      // Firm mismatch is a 404 — no existence oracle across firm boundaries.
      if (row === undefined || row.firm_id !== firmId) {
        return problemJson(c, { type: "not-found", status: 404, title: "Not found" });
      }
      // The guarded UPDATE moves requested/active→revoked only; already-terminal grants produce
      // changes === 0, treated as 404 so callers cannot probe terminal state.
      const update = await revokeSupportGrantStatement(c.env.DB_CONTROL, {
        id: grantId,
        firmId,
      }).run();
      if (update.meta.changes === 0) {
        return problemJson(c, { type: "not-found", status: 404, title: "Grant already terminal" });
      }
      const now = new Date().toISOString();
      await writeSupportAudit(c.env.DB_CONTROL, {
        event: "support.grant.revoked",
        requesterUserId: row.requested_by_user_id,
        metadata: { grantId, firmId, revokedByUserId: actingUserId },
        now,
      });
      return c.json({ id: grantId, status: "revoked" } as z.infer<typeof GrantStatusResult>, 200);
    },
  );
}
