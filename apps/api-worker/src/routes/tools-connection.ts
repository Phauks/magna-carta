import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// Cloudflare populates `request.cf` on every production request; the empty-string / zero values
// below are the local-runtime (Miniflare) degradation the handler substitutes when `cf` is
// absent, not meaningful field values a caller should read as real edge data.
const ConnectionResponse = z
  .object({
    ip: z.string(),
    asn: z.number(),
    asOrganization: z.string(),
    colo: z.string(),
    country: z.string(),
  })
  .openapi("ToolsConnectionResponse");

// Reads only what the edge already knows about this request — no database, no bindings — so the
// handler adds no work of its own to the round trip. The caller's own address is returned to the
// caller and never logged.
export const toolsConnectionMeta: RouteMeta = {
  operationId: "toolsConnection.get",
  surface: "app",
  authenticated: true,
  permission: "tools:speedTest",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const toolsConnectionRoute = defineOpenAPIRoute(toolsConnectionMeta, {
  method: "get",
  path: "/api/v1/tools/connection",
  description:
    "What the edge sees about this caller's connection: public address, network operator, and the edge location serving the request.",
  responses: {
    200: {
      description: "The caller's connection as the edge sees it",
      content: { "application/json": { schema: ConnectionResponse } },
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
  },
});

export function registerToolsConnectionRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...toolsConnectionRoute, middleware: chokepointMiddleware(chokepoint, toolsConnectionRoute) },
    (c) => {
      // `cf` is absent in local test runtimes; the empty defaults keep the contract satisfied
      // rather than throwing on a diagnostic surface.
      const edge = c.req.raw.cf;
      return c.json(
        {
          ip: c.req.header("CF-Connecting-IP") ?? "",
          asn: typeof edge?.asn === "number" ? edge.asn : 0,
          asOrganization: typeof edge?.asOrganization === "string" ? edge.asOrganization : "",
          colo: typeof edge?.colo === "string" ? edge.colo : "",
          country: typeof edge?.country === "string" ? edge.country : "",
        },
        200,
      );
    },
  );
}
