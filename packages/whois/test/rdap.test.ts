import { expect, test } from "vitest";
import { resolveRdapBase, queryRdap } from "../src/rdap.ts";
import type { HttpClient } from "@magna-carta/integrations/http";

function fakeHttp(routes: Record<string, unknown>): HttpClient {
  return {
    async request({ url }) {
      const body = routes[url];
      if (body === undefined) return { status: 404, json: async () => ({}) };
      return { status: 200, json: async () => body };
    },
  };
}

test("resolveRdapBase finds the base URL for a TLD", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": {
      services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]]],
    },
  });
  expect(await resolveRdapBase("example.com", http)).toBe("https://rdap.verisign.com/com/v1/");
});

test("resolveRdapBase returns null for a TLD with no RDAP server", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": {
      services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]],
    },
  });
  expect(await resolveRdapBase("example.xn--unknown", http)).toBeNull();
});

test("queryRdap maps registrar, dates, nameservers, statuses", async () => {
  const http = fakeHttp({
    "https://rdap.verisign.com/com/v1/domain/example.com": {
      status: ["client transfer prohibited"],
      nameservers: [{ ldhName: "a.iana-servers.net" }, { ldhName: "b.iana-servers.net" }],
      events: [
        { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
        { eventAction: "expiration", eventDate: "2026-08-13T04:00:00Z" },
        { eventAction: "last changed", eventDate: "2025-08-14T07:01:44Z" },
      ],
      entities: [
        { roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "RESERVED-Internet"]]] },
      ],
    },
  });
  const result = await queryRdap("example.com", "https://rdap.verisign.com/com/v1/", http);
  expect(result.source).toBe("rdap");
  expect(result.registeredAt).toBe("1995-08-14T04:00:00Z");
  expect(result.expiresAt).toBe("2026-08-13T04:00:00Z");
  expect(result.lastChangedAt).toBe("2025-08-14T07:01:44Z");
  expect(result.nameservers).toEqual(["a.iana-servers.net", "b.iana-servers.net"]);
  expect(result.statuses).toEqual(["client transfer prohibited"]);
  expect(result.registrar).toBe("RESERVED-Internet");
});

test("queryRdap joins base and path without double slashes", async () => {
  let requestedUrl: string | undefined;
  const http: HttpClient = {
    async request({ url }) {
      requestedUrl = url;
      return {
        status: 200,
        json: async () => ({ status: [], nameservers: [], events: [], entities: [] }),
      };
    },
  };
  await queryRdap("example.com", "https://rdap.verisign.com/com/v1", http);
  expect(requestedUrl).toBe("https://rdap.verisign.com/com/v1/domain/example.com");
});

test("queryRdap is defensive when optional fields are absent", async () => {
  const http = fakeHttp({
    "https://rdap.example.com/domain/sparse.org": {
      // No events, nameservers, entities, or status
    },
  });
  const result = await queryRdap("sparse.org", "https://rdap.example.com/", http);
  expect(result.source).toBe("rdap");
  expect(result.target).toBe("sparse.org");
  expect(result.registeredAt).toBeUndefined();
  expect(result.expiresAt).toBeUndefined();
  expect(result.lastChangedAt).toBeUndefined();
  expect(result.nameservers).toBeUndefined();
  expect(result.statuses).toBeUndefined();
  expect(result.registrar).toBeUndefined();
});
