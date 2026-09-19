import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { writeFirmReleaseChannelStatement } from "@magna-carta/data-access/firm-release-channel-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointIdempotency } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { platformAdminGuard } from "./firms.ts";

const PlatformSetReleaseChannelRequest = z
  .object({
    // Allows "alpha", which the firm-admin surface rejects at the schema level.
    channel: z.enum(["stable", "beta", "alpha"]),
  })
  .openapi("PlatformSetReleaseChannelRequest");

const PlatformSetReleaseChannelResponse = z
  .object({ channel: z.enum(["stable", "beta", "alpha"]) })
  .openapi("PlatformSetReleaseChannelResponse");

// surface: "public" is the platform-admin exception — the platformAdminGuard does the auth
// (secret header check); the chokepoint skips session/firm/RBAC gates and still owns the
// rate-limit and idempotency gates. permission: "firm:provision" is the nominal capability
// (public routes skip the RBAC gate; the secret guard is the real auth here).
export const platformSetReleaseChannelMeta: RouteMeta = {
  operationId: "platform.setFirmReleaseChannel",
  surface: "public",
  authenticated: true,
  permission: "firm:provision",
  resource: "firm",
  audited: true,
  idempotency: "required",
  rateLimit: "auth",
};

export const platformSetReleaseChannelRoute = defineOpenAPIRoute(platformSetReleaseChannelMeta, {
  method: "post",
  path: "/api/v1/platform/firms/{firmId}/release-channel",
  description:
    "Platform-admin endpoint to set any firm's release channel (including alpha). " +
    "Requires the X-Platform-Admin-Key secret header. Alpha is accessible only through this " +
    "platform path; the firm-admin PUT /api/v1/firm/release-channel accepts stable and beta only.",
  request: {
    headers: idempotencyKeyHeader,
    params: z.object({
      firmId: identifierPathParam("firm", "firmId"),
    }),
    body: {
      content: { "application/json": { schema: PlatformSetReleaseChannelRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's release channel after the update",
      content: { "application/json": { schema: PlatformSetReleaseChannelResponse } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "Missing or wrong X-Platform-Admin-Key",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No firm with the given identifier exists in the control plane",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "Validation failed (channel value outside the allowed set); or the Idempotency-Key " +
        "was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Registers POST /api/v1/platform/firms/{firmId}/release-channel through the chokepoint, with
// the platform-admin secret guard as route-specific middleware (running before the chokepoint's
// idempotency/rate-limit gates). The handler runs only past all of them.
export function registerPlatformReleaseChannelRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...platformSetReleaseChannelRoute,
      middleware: chokepointMiddleware(chokepoint, platformSetReleaseChannelRoute, [
        platformAdminGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { firmId } = c.req.valid("param");
      const { channel } = c.req.valid("json");

      // Check the firm exists before acquiring the idempotency key. A non-existent firm is a
      // permanent condition — the 404 need not be stored for replay. Reading release_channel here
      // also captures the old value for the audit trail without a second query.
      const firmRow = await c.env.DB_CONTROL.prepare(
        "SELECT id, release_channel FROM firm WHERE id = ?1",
      )
        .bind(firmId)
        .first<{ id: string; release_channel: string | null }>();

      if (firmRow === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Firm not found",
          status: 404,
          detail: "No firm with this identifier exists in the control plane.",
        });
      }

      const idempotency = requireChokepointIdempotency(c);
      const oldChannel = firmRow.release_channel ?? "stable";
      const now = new Date().toISOString();

      const result = await runIdempotentEffect({
        database: c.env.DB_CONTROL,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        effect: async () => ({
          write: {
            statements: [
              writeFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId as FirmId, channel),
              insertAuthAuditStatement(c.env.DB_CONTROL, {
                id: newIdentifier("authAudit"),
                event: "firm.release_channel_set_alpha",
                userId: null,
                metadata: { firmId, oldChannel, newChannel: channel },
                now,
              }),
            ],
            outboxMessages: [],
          },
          responseCode: 200,
          responseBody: canonicalJsonStringify({ channel }),
        }),
      });

      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }

      if (result.kind === "replayed") {
        c.header("Idempotency-Replayed", "true");
      }

      return c.json({ channel }, 200);
    },
  );
}
