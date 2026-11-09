import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpClient } from "@magna-carta/integrations/http";
import type { WhoisSocket } from "@magna-carta/whois/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A fake RDAP HTTP client: serves the IANA bootstrap registry and one RDAP domain endpoint;
// 404s for anything else. The whois package uses this to resolve RDAP without any real network calls.
function fakeRdapHttp(): HttpClient {
  return {
    async request(req) {
      if (req.url === "https://data.iana.org/rdap/dns.json") {
        return {
          status: 200,
          json: async () => ({
            services: [[["com"], ["https://rdap.example/com/"]]],
          }),
        };
      }
      if (req.url === "https://rdap.example/com/domain/example.com") {
        return {
          status: 200,
          json: async () => ({
            status: ["active"],
            events: [
              { eventAction: "registration", eventDate: "2000-01-01T00:00:00Z" },
              { eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" },
            ],
            nameservers: [{ ldhName: "ns1.example.com" }],
          }),
        };
      }
      return { status: 404, json: async () => ({}) };
    },
  };
}

// A stub socket: RDAP paths never reach port-43, but the field must exist in WhoisRouteDeps.
function fakeSocket(): WhoisSocket {
  return {
    async query(_host, _request) {
      return "% stub — RDAP path was used instead";
    },
  };
}

const app = createApp({ whoisDeps: { http: fakeRdapHttp(), socket: fakeSocket() } });

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "WHOIS Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("GET /api/v1/whois", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await app.request(
      "https://example.com/api/v1/whois?query=example.com",
      {},
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:whois", async () => {
    // seedCredentialedUser assigns no role; membership alone carries no permission, so 0016's grants do not apply.
    await seedCredentialedUser("whois-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("whois-noperm@example.com");
    const response = await app.request(
      "https://example.com/api/v1/whois?query=example.com",
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the RDAP result for an Admin member", async () => {
    const { userId } = await seedCredentialedUser("whois-ok@example.com", {
      userName: "WHOIS OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "WHOIS OK", poolFirmId); // Admin carries tools:whois (0016)
    const cookie = await signInForSessionCookie("whois-ok@example.com");
    const response = await app.request(
      "https://example.com/api/v1/whois?query=example.com",
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { source: string; target: string };
    expect(body.source).toBe("rdap");
    expect(body.target).toBe("example.com");
  });

  // A registry with no RDAP bootstrap entry and no known port-43 host is the common case for
  // roughly a sixth of the IANA TLD list. It must read as "this registry cannot be looked up",
  // never as a server fault with an Error ID to quote at support.
  it("answers 501 rather than 500 for a registry with no lookup service", async () => {
    const { userId } = await seedCredentialedUser("whois-unsupported@example.com", {
      userName: "WHOIS Unsupported",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "WHOIS Unsupported", poolFirmId);
    const cookie = await signInForSessionCookie("whois-unsupported@example.com");
    // ".ch" is absent from the fake bootstrap above and from the port-43 host table.
    const response = await app.request(
      "https://example.com/api/v1/whois?query=admin.ch",
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(501);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await response.json()) as { type: string; detail: string };
    expect(problem.type).toContain("not-implemented");
    expect(problem.detail).toContain(".ch");
  });

  // A registry that rate-limits or is away must read as a retryable outage, never as an empty
  // registration record ("no registration record found") that a retry then contradicts.
  it("answers 502 when the RDAP server faults instead of parsing the fault as absence", async () => {
    const faultingHttp: HttpClient = {
      async request(req) {
        if (req.url === "https://data.iana.org/rdap/dns.json") {
          return {
            status: 200,
            json: async () => ({ services: [[["com"], ["https://rdap.example/com/"]]] }),
          };
        }
        return { status: 429, json: async () => ({}) };
      },
    };
    const faultingApp = createApp({ whoisDeps: { http: faultingHttp, socket: fakeSocket() } });
    const { userId } = await seedCredentialedUser("whois-fault@example.com", {
      userName: "WHOIS Fault",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "WHOIS Fault", poolFirmId);
    const cookie = await signInForSessionCookie("whois-fault@example.com");
    const response = await faultingApp.request(
      "https://example.com/api/v1/whois?query=example.com",
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("service-unavailable");
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await app.request("https://example.com/api/openapi.json", {}, env);
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/whois"]?.get;
    expect(operation?.["operationId"]).toBe("whois.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "whois.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:whois",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
