import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// Minted per run and short-lived on purpose. A TURN credential is a relay authorization billed to
// this account, so it is never long-lived and never handed to an unauthenticated caller.
const CREDENTIAL_TTL_SECONDS = 600;

const TurnCredentials = z
  .object({ username: z.string(), credential: z.string() })
  .openapi("TurnCredentials");

export const toolsTurnCredentialsMeta: RouteMeta = {
  operationId: "toolsTurnCredentials.get",
  surface: "app",
  authenticated: true,
  permission: "tools:speedTest",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

export const toolsTurnCredentialsRoute = defineOpenAPIRoute(toolsTurnCredentialsMeta, {
  method: "get",
  path: "/api/v1/tools/turn-credentials",
  description:
    "Short-lived relay credentials used to measure packet loss. Answers 503 when relay measurement is not configured.",
  responses: {
    200: {
      description: "Short-lived relay credentials",
      content: { "application/json": { schema: TurnCredentials } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:speedTest",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    502: {
      description: "The relay credential service refused",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Relay measurement is not configured for this deployment",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Cloudflare answers with a list of ICE servers; only one entry carries credentials. Find it by the
// fields we need rather than by position.
function credentialsFrom(payload: unknown): { username: string; credential: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const servers = (payload as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(servers)) return null;
  for (const server of servers) {
    if (typeof server !== "object" || server === null) continue;
    const { username, credential } = server as { username?: unknown; credential?: unknown };
    if (typeof username === "string" && typeof credential === "string") {
      return { username, credential };
    }
  }
  return null;
}

export function registerToolsTurnCredentialsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...toolsTurnCredentialsRoute,
      middleware: chokepointMiddleware(chokepoint, toolsTurnCredentialsRoute),
    },
    async (c) => {
      const keyId = c.env.REALTIME_TURN_TOKEN_ID;
      const apiToken = c.env.REALTIME_TURN_TOKEN_SECRET;

      // Not an error to report upstream: this deployment simply does not measure packet loss. The
      // caller-facing detail never names the secrets.
      if (!keyId || !apiToken) {
        return problemJson(c, {
          type: "service-unavailable",
          status: 503,
          title: "Relay measurement is not configured",
          detail: "This deployment cannot measure packet loss.",
        });
      }

      const upstream = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        },
      );

      // Never surface the upstream body: it may echo the key id.
      if (!upstream.ok) {
        return problemJson(c, {
          type: "internal",
          status: 502,
          title: "The relay credential service refused",
          detail: "Packet loss could not be measured.",
        });
      }

      const credentials = credentialsFrom(await upstream.json());
      if (credentials === null) {
        return problemJson(c, {
          type: "internal",
          status: 502,
          title: "The relay credential service refused",
          detail: "Packet loss could not be measured.",
        });
      }

      return c.json(credentials, 200);
    },
  );
}
