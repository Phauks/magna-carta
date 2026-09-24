import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { recordRealtimeFailure } from "../../realtime/realtime-failure.ts";
import { credentialedServer, generateIceServers } from "../../realtime/turn-credentials.ts";

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
      const mint = await generateIceServers(c.env, CREDENTIAL_TTL_SECONDS);

      // Not an error to report upstream: this deployment simply does not measure packet loss. The
      // caller-facing detail never names the secrets.
      if (mint.kind === "not-configured") {
        return problemJson(c, {
          type: "service-unavailable",
          status: 503,
          title: "Relay measurement is not configured",
          detail: "This deployment cannot measure packet loss.",
        });
      }

      // A mint that should have worked and did not is a fault this deployment owns, so it is
      // recorded and the caller is handed the Error ID that joins the two. The upstream body never
      // reaches either: it may echo the key id.
      const credentials =
        mint.kind === "minted" ? credentialedServer(mint.servers) : /* unreadable */ null;
      if (credentials === null) {
        const errorId = recordRealtimeFailure(
          c.get("logger"),
          "realtime.turnCredentials.tools",
          new Error(
            mint.kind === "failed"
              ? `relay credentials could not be minted (${mint.cause})`
              : "the relay credential service answered with no authenticated server",
          ),
          c.get("correlationId"),
        );
        return problemJson(c, {
          type: "internal",
          status: 502,
          title: "The relay credential service refused",
          detail: "Packet loss could not be measured.",
          errorId,
        });
      }

      return c.json(credentials, 200);
    },
  );
}
