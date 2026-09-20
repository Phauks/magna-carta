import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { lookupRegistration, RdapUpstreamFailure, UnsupportedRegistry } from "@magna-carta/whois";
import type { WhoisDeps } from "@magna-carta/whois/types";
import { SsrfRejection } from "@magna-carta/integrations/safe-target";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// Re-export WhoisDeps from the whois package as the route's dependency type so this file and
// app.ts share one definition and cannot drift.
export type { WhoisDeps as WhoisRouteDeps };

const WhoisQuery = z.object({
  query: z.string().min(1).max(255),
});

const WhoisResponse = z
  .object({
    source: z.enum(["rdap", "whois-43"]),
    target: z.string(),
    registrar: z.string().optional(),
    registeredAt: z.string().optional(),
    expiresAt: z.string().optional(),
    lastChangedAt: z.string().optional(),
    nameservers: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    registrant: z.string().optional(),
    raw: z.string().optional(),
  })
  .openapi("WhoisResponse");

// Read-only, per-firm. The chokepoint resolves the session + firm and enforces tools:whois; the
// handler calls the whois package which performs RDAP-first lookup with a port-43 fallback for
// registries that have not adopted RDAP. The tenancy resource is the firm.
export const whoisMeta: RouteMeta = {
  operationId: "whois.get",
  surface: "app",
  authenticated: true,
  permission: "tools:whois",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const whoisRoute = defineOpenAPIRoute(whoisMeta, {
  method: "get",
  path: "/api/v1/whois",
  description:
    "Registration data (RDAP, with a legacy WHOIS fallback) for a website's domain or an IP address.",
  request: {
    query: WhoisQuery,
  },
  responses: {
    200: {
      description: "The registration record for the queried domain or IP address",
      content: { "application/json": { schema: WhoisResponse } },
    },
    400: {
      description: "The query target is not a valid public domain or IP address",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:whois",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    501: {
      description:
        "The target's registry publishes no lookup service this platform can reach (no RDAP entry, no known port-43 host)",
      content: { "application/problem+json": { schema: Problem } },
    },
    502: {
      description:
        "The registry's lookup service answered with a fault (rate limit or outage) rather than a record or a not-found",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerWhoisRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  deps: WhoisDeps,
): void {
  app.openapi(
    { ...whoisRoute, middleware: chokepointMiddleware(chokepoint, whoisRoute) },
    async (c) => {
      const { query } = c.req.valid("query");
      try {
        const result = await lookupRegistration(query, deps);
        // RegistrationResult uses readonly arrays; WhoisResponse expects mutable arrays.
        // Spread each array field into a new mutable array before returning.
        return c.json(
          {
            ...result,
            nameservers: result.nameservers ? [...result.nameservers] : undefined,
            statuses: result.statuses ? [...result.statuses] : undefined,
          },
          200,
        );
      } catch (error) {
        if (error instanceof UnsupportedRegistry) {
          // Not a fault: roughly a sixth of the IANA TLD list publishes neither an RDAP service nor
          // a port-43 host this platform knows. Say so plainly — an Error ID here would send someone
          // to support over a registry that simply does not answer machine queries. The TLD is echoed
          // because it is a public suffix, never the user's own query string.
          return problemJson(c, {
            type: "not-implemented",
            status: 501,
            title: "This registry cannot be looked up",
            detail: `The ".${error.tld}" registry publishes no lookup service this tool can reach. Check the registry's own WHOIS page directly.`,
          });
        }
        if (error instanceof RdapUpstreamFailure) {
          // The registry (or the IANA bootstrap) answered with a fault — a rate limit or an
          // outage. Before this branch existed the empty body was parsed as a record with no
          // fields, and the page reported "no registration record found" for a target whose
          // record a retry then returned. A transient upstream fault is retryable, so no Error ID.
          return problemJson(c, {
            type: "service-unavailable",
            status: 502,
            title: "The registry did not answer",
            detail:
              "The registry's lookup service is rate-limiting or unavailable. Try again shortly.",
          });
        }
        if (error instanceof SsrfRejection) {
          // Never echo the raw query or resolved host into the response — return a generic
          // message that does not leak the user-supplied target or any resolved IP address.
          return problemJson(c, {
            type: "validation",
            status: 400,
            title: "The query target is not a valid public address",
            detail: "The supplied query did not resolve to a publicly routable address.",
          });
        }
        // All other errors propagate to the standard telemetry error pipeline (→ 500 with Error ID).
        throw error;
      }
    },
  );
}
