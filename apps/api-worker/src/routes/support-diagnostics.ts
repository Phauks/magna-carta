import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
} from "../chokepoint/context-accessors.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const SupportDiagnosticOverview = z
  .object({
    firmId: z.string(),
    firmStatus: z.string(),
    perFirmSchemaVersion: z.string().nullable(),
    bucketProvisioned: z.boolean(),
    activeMemberCount: z.number().int(),
  })
  .openapi("SupportDiagnosticOverview");

// Read-only, firm-scoped overview for help-desk diagnosis. The diagnostics:overview permission is
// intentionally never seeded to any firm role — it is held only by a diagnostic support session,
// so only a support principal acting under an active diagnostic grant can reach this surface.
export const diagnosticOverviewMeta: RouteMeta = {
  operationId: "supportDiagnostics.overview",
  surface: "app",
  authenticated: true,
  permission: "diagnostics:overview",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const diagnosticOverviewRoute = defineOpenAPIRoute(diagnosticOverviewMeta, {
  method: "get",
  path: "/api/v1/support/diagnostics/overview",
  description:
    "Non-privileged firm system state for help-desk diagnosis: firm status, per-firm schema " +
    "version, storage provisioning state, and active member count. Accessible only from a " +
    "diagnostic support session — the permission is never seeded to a firm role.",
  responses: {
    200: {
      description: "The firm system-state overview",
      content: { "application/json": { schema: SupportDiagnosticOverview } },
    },
    401: {
      description:
        "No valid session, or the support-session token's backing grant is revoked or expired",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the principal lacks diagnostics:overview",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The session's firm is not reachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerSupportDiagnosticsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...diagnosticOverviewRoute,
      middleware: chokepointMiddleware(chokepoint, diagnosticOverviewRoute),
    },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const { firmDatabase, bucketName } = requireChokepointFirmContext(c);
      const firmRow = await c.env.DB_CONTROL.prepare(
        "SELECT status, per_firm_schema_version FROM firm WHERE id = ?1",
      )
        .bind(firmId)
        .first<{ status: string; per_firm_schema_version: string | null }>();
      const memberCountRow = await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM member WHERE status = 'active'")
        .first<{ n: number }>();
      return c.json(
        {
          firmId,
          firmStatus: firmRow?.status ?? "unknown",
          perFirmSchemaVersion: firmRow?.per_firm_schema_version ?? null,
          bucketProvisioned: bucketName !== null,
          activeMemberCount: memberCountRow?.n ?? 0,
        },
        200,
      );
    },
  );
}
