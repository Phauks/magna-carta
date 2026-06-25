import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { readFirmReleaseChannelStatement } from "@magna-carta/data-access/firm-release-channel-statements";
import { writeFirmReleaseChannelStatement } from "@magna-carta/data-access/firm-release-channel-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const SetReleaseChannelRequest = z
  .object({
    channel: z.enum(["stable", "beta"]),
    // The firm acknowledges running pre-release behavior on live data. Required to enter beta;
    // ignored when returning to stable.
    consentAcknowledged: z.boolean().default(false),
  })
  .openapi("SetReleaseChannelRequest");

const SetReleaseChannelResponse = z
  .object({ channel: z.enum(["stable", "beta"]) })
  .openapi("SetReleaseChannelResponse");

// The route metadata. The chokepoint enforces the full security order: session → firm (404 on
// absence/deactivation) → firm:manageReleaseChannel (403) → Idempotency-Key requirement + the
// firm-scoped idempotency pre-decision → rate limit. The handler runs only past all of it.
export const setReleaseChannelMeta: RouteMeta = {
  operationId: "firm.setReleaseChannel",
  surface: "app",
  authenticated: true,
  permission: "firm:manageReleaseChannel",
  resource: "firm",
  audited: true,
  idempotency: "required",
  // Business effect targets the control-plane firm registry — the idempotency record commits there
  // too so the record and the channel write are in the same database (atomic-batch aligned).
  idempotencyStore: "control",
  rateLimit: "default",
};

export const setReleaseChannelRoute = defineOpenAPIRoute(setReleaseChannelMeta, {
  method: "put",
  path: "/api/v1/firm/release-channel",
  description:
    "Sets the session firm's release channel to stable or beta. Moving to beta requires an " +
    "explicit consent acknowledgment (the firm confirms it accepts pre-release behavior on live " +
    "data). Returning to stable needs no acknowledgment. Alpha is a platform-only channel and " +
    "is rejected at the schema level.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: SetReleaseChannelRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's release channel after the update",
      content: { "application/json": { schema: SetReleaseChannelResponse } },
    },
    400: {
      description:
        "Missing Idempotency-Key (this operation requires one); or beta requested without consent acknowledgment",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:manageReleaseChannel",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable from this deployment, or the session member is " +
        "deactivated (absent, never an existence oracle)",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "Validation failed (e.g. channel value outside the firm-accessible set); or the " +
        "Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Registers PUT /api/v1/firm/release-channel through the chokepoint. The handler runs only past
// the chokepoint (session + firm:manageReleaseChannel + the control-plane idempotency pre-decision).
// The authForEnv parameter follows the registration signature members.ts uses; it is not needed here
// because this route has no post-commit external effects (no email, no provisioning outbox).
export function registerReleaseChannelRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  _authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): void {
  app.openapi(
    {
      ...setReleaseChannelRoute,
      middleware: chokepointMiddleware(chokepoint, setReleaseChannelRoute),
    },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const firmContext = requireChokepointFirmContext(c);

      const { channel, consentAcknowledged } = c.req.valid("json");

      // Entering beta requires the firm to acknowledge running pre-release behavior on live data.
      // Returning to stable needs no consent — the downgrade is always permitted.
      if (channel === "beta" && !consentAcknowledged) {
        return problemJson(c, {
          type: "beta-consent-required",
          title: "Consent required for beta channel",
          status: 400,
          detail:
            "Moving to the beta release channel requires consentAcknowledged: true. " +
            "The firm must confirm it accepts pre-release behavior on live data.",
        });
      }

      const now = new Date().toISOString();

      // Read the current channel before writing — captured for the audit trail.
      const channelRow = await readFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId).first<{
        release_channel: string;
      }>();
      const oldChannel = channelRow?.release_channel ?? "stable";

      // Write the new channel to the control-plane firm registry.
      await writeFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId, channel).run();

      // Write the per-firm audit row (ids + non-privileged fields only, never privileged content).
      await insertAuditLogStatement(firmContext.firmDatabase, {
        id: newIdentifier("auditLog"),
        event: "firm.release_channel_changed",
        actorUserId: userId,
        subjectId: firmId,
        metadata: {
          firmId,
          oldChannel,
          newChannel: channel,
          consentAcknowledged: channel === "beta",
        },
        now,
      }).run();

      return c.json({ channel }, 200);
    },
  );
}
