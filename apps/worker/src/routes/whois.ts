import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { lookupRegistration, WhoisTransportError } from "@magna-carta/whois";
import type { WhoisDeps } from "@magna-carta/whois/types";
import { SsrfRejection } from "@magna-carta/integrations/safe-target";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// Re-export WhoisDeps from the whois package as the route's dependency type so this file and
// app.ts share one definition and cannot drift.
export type { WhoisDeps as WhoisRouteDeps };

const WhoisQuery = z.object({
  query: z.string().min(1).max(255),
});

// The provenance every result carries: the exact target queried, the UTC instant of the lookup, and
// which server answered. The report is an exhibit, so these are mandatory on every kind.
const Provenance = z.object({
  target: z.string(),
  retrievedAt: z.string(),
  respondingServer: z.string(),
});

// A field whose silence is typed, never a blank cell: present with a value, simply not provided,
// withheld by the registry (quoting the registry's own words), or not applicable to this object kind.
function fieldState<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("present"), value }),
    z.object({ state: z.literal("notProvided") }),
    z.object({ state: z.literal("redacted"), notice: z.string() }),
    z.object({ state: z.literal("notApplicable") }),
  ]);
}

const Registrar = z.object({
  name: z.string().optional(),
  ianaId: z.string().optional(),
});

const AbuseContact = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
});

const RdapContact = z.object({
  name: z.string().optional(),
  organization: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.array(z.string()).readonly().optional(),
});

const Nameserver = z.object({
  ldhName: z.string(),
  ipv4: z.array(z.string()).readonly().optional(),
  ipv6: z.array(z.string()).readonly().optional(),
});

const DsData = z.object({
  keyTag: z.number().optional(),
  algorithm: z.number().optional(),
  digestType: z.number().optional(),
  digest: z.string().optional(),
});

const SecureDns = z.object({
  delegationSigned: z.boolean(),
  dsData: z.array(DsData).readonly().optional(),
});

const RdapEvent = z.object({
  action: z.string(),
  date: z.string(),
});

const RdapRemark = z.object({
  title: z.string().optional(),
  type: z.string().optional(),
  description: z.array(z.string()).readonly(),
});

const DomainRegistration = z.object({
  kind: z.literal("domain"),
  source: z.literal("rdap"),
  provenance: Provenance,
  handle: z.string().optional(),
  ldhName: z.string().optional(),
  unicodeName: z.string().optional(),
  registrar: fieldState(Registrar),
  abuse: fieldState(AbuseContact),
  registrant: fieldState(RdapContact),
  administrative: fieldState(RdapContact),
  technical: fieldState(RdapContact),
  nameservers: fieldState(z.array(Nameserver).readonly()),
  secureDns: SecureDns.optional(),
  statuses: z.array(z.string()).readonly().optional(),
  events: z.array(RdapEvent).readonly().optional(),
  port43: z.string().optional(),
  remarks: z.array(RdapRemark).readonly().optional(),
  notices: z.array(RdapRemark).readonly().optional(),
  rdapConformance: z.array(z.string()).readonly().optional(),
  rawRdap: z.unknown(),
});

const IpNetworkRegistration = z.object({
  kind: z.literal("ip"),
  source: z.literal("rdap"),
  provenance: Provenance,
  handle: z.string().optional(),
  startAddress: z.string().optional(),
  endAddress: z.string().optional(),
  ipVersion: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  country: z.string().optional(),
  parentHandle: z.string().optional(),
  cidr: z.array(z.string()).readonly().optional(),
  abuse: fieldState(AbuseContact),
  registrar: fieldState(Registrar),
  nameservers: fieldState(z.array(Nameserver).readonly()),
  statuses: z.array(z.string()).readonly().optional(),
  events: z.array(RdapEvent).readonly().optional(),
  remarks: z.array(RdapRemark).readonly().optional(),
  rawRdap: z.unknown(),
});

const LegacyWhoisRecord = z.object({
  kind: z.literal("legacy"),
  source: z.literal("whois-43"),
  provenance: Provenance,
  raw: z.string(),
  timezoneUnspecified: z.literal(true),
});

const WhoisResponse = z
  .discriminatedUnion("kind", [DomainRegistration, IpNetworkRegistration, LegacyWhoisRecord])
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
  // A lookup can surface a natural person's postal address (some ccTLDs publish a full registrant
  // contact), which is personal data — so the read writes a whois.looked_up row to the per-firm
  // audit_log recording who looked up what target, and when.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const whoisRoute = defineOpenAPIRoute(whoisMeta, {
  method: "get",
  path: "/api/v1/whois",
  description:
    "Registration data (RDAP, with a legacy WHOIS fallback) for a website's domain or an IP address. Absent fields are typed as not-provided, redacted, or not-applicable, and the complete unmodified response is retained.",
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
    503: {
      description: "An upstream registry service (IANA bootstrap or RDAP) was unreachable",
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
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { query } = c.req.valid("query");
      try {
        const result = await lookupRegistration(query, deps);

        // Write the chain-of-custody audit row before returning. Metadata carries the target, object
        // kind, responding server, and instant — the operational facts of who looked up what — never
        // any contact detail surfaced from the response (redacted by default).
        const auditLogId = newIdentifier("auditLog");
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              insertAuditLogStatement(firm.firmDatabase, {
                id: auditLogId,
                event: "whois.looked_up",
                actorUserId: userId,
                subjectId: null,
                metadata: {
                  target: result.provenance.target,
                  kind: result.kind,
                  source: result.source,
                  respondingServer: result.provenance.respondingServer,
                  retrievedAt: result.provenance.retrievedAt,
                },
                now: result.provenance.retrievedAt,
              }),
            ],
            outboxMessages: [],
          },
          { now: () => result.provenance.retrievedAt },
        );

        return c.json(result, 200);
      } catch (error) {
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
        if (error instanceof WhoisTransportError) {
          // The IANA bootstrap or an RDAP server was unreachable — a transport failure, distinct from
          // "this registry has no record". Surface it as a retryable 503 rather than misreading it as
          // a fact about the registration. The generic detail never echoes the query or an upstream URL.
          return problemJson(c, {
            type: "service-unavailable",
            status: 503,
            title: "Registry lookup service unavailable",
            detail: "An upstream registry service was unreachable. Try again shortly.",
          });
        }
        // All other errors propagate to the standard telemetry error pipeline (→ 500 with Error ID).
        throw error;
      }
    },
  );
}
