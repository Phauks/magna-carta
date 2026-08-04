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

// --- IP bootstrap resolution ---
//
// The bootstrap keys below are deliberately off an octet/nibble boundary: a text-prefix matcher
// gets every one of these wrong, either by missing a member of the block or by claiming an address
// that merely shares leading characters.

const IPV4_BOOTSTRAP = "https://data.iana.org/rdap/ipv4.json";
const IPV6_BOOTSTRAP = "https://data.iana.org/rdap/ipv6.json";

test("resolveIpBase matches an address inside a /22 that shares no leading label", async () => {
  const http = fakeHttp({
    [IPV4_BOOTSTRAP]: {
      services: [[["198.51.100.0/22"], ["https://rdap.example-registry.test/"]]],
    },
  });
  // 198.51.101.5 and 198.51.103.255 are both inside 198.51.100.0/22, and neither starts with
  // "198.51.100".
  expect(await resolveRdapBase("198.51.101.5", http)).toBe("https://rdap.example-registry.test/");
  expect(await resolveRdapBase("198.51.103.255", http)).toBe("https://rdap.example-registry.test/");
  // The next block up is outside the /22 even though it shares the first two labels.
  expect(await resolveRdapBase("198.51.104.1", http)).toBeNull();
});

test("resolveIpBase rejects an address that only shares leading text with the network", async () => {
  const http = fakeHttp({
    [IPV4_BOOTSTRAP]: { services: [[["192.0.2.128/25"], ["https://rdap.upper.test/"]]] },
  });
  expect(await resolveRdapBase("192.0.2.200", http)).toBe("https://rdap.upper.test/");
  // Inside the same /24 but below the /25 boundary — a startsWith matcher would claim it.
  expect(await resolveRdapBase("192.0.2.5", http)).toBeNull();
});

test("resolveIpBase prefers the longest matching prefix", async () => {
  const http = fakeHttp({
    [IPV4_BOOTSTRAP]: {
      services: [
        [["203.0.0.0/8"], ["https://rdap.broad.test/"]],
        [["203.0.113.0/26"], ["https://rdap.specific.test/"]],
      ],
    },
  });
  // Both blocks contain it; the more specific delegation is authoritative.
  expect(await resolveRdapBase("203.0.113.7", http)).toBe("https://rdap.specific.test/");
  // Only the broad block contains this one.
  expect(await resolveRdapBase("203.0.113.90", http)).toBe("https://rdap.broad.test/");
});

test("resolveIpBase matches IPv6 across a non-nibble-boundary prefix", async () => {
  const http = fakeHttp({
    [IPV6_BOOTSTRAP]: { services: [[["2001:db8:8000::/33"], ["https://rdap.sixes.test/"]]] },
  });
  expect(await resolveRdapBase("2001:db8:c000::1", http)).toBe("https://rdap.sixes.test/");
  // Bracketed literals are the same address.
  expect(await resolveRdapBase("[2001:db8:ffff::9]", http)).toBe("https://rdap.sixes.test/");
  // The lower half of the same /32 is outside the /33.
  expect(await resolveRdapBase("2001:db8:7fff::1", http)).toBeNull();
});

test("resolveRdapBase routes a hex IPv6 literal to the IPv6 bootstrap, not the DNS one", async () => {
  const requested: string[] = [];
  const http: HttpClient = {
    async request({ url }) {
      requested.push(url);
      return {
        status: 200,
        json: async () => ({ services: [[["2001:db8::/32"], ["https://rdap.sixes.test/"]]] }),
      };
    },
  };
  expect(await resolveRdapBase("2001:db8::1", http)).toBe("https://rdap.sixes.test/");
  expect(requested).toEqual([IPV6_BOOTSTRAP]);
});

test("resolveRdapBase treats a dotted fragment that is not an address as a domain", async () => {
  const requested: string[] = [];
  const http: HttpClient = {
    async request({ url }) {
      requested.push(url);
      return { status: 200, json: async () => ({ services: [] }) };
    },
  };
  // "1.2.3" is not an IPv4 address; it must not be sent to the IP bootstrap.
  await resolveRdapBase("1.2.3", http);
  expect(requested).toEqual(["https://data.iana.org/rdap/dns.json"]);
});

test("resolveIpBase returns null when no bootstrap block contains the address", async () => {
  const http = fakeHttp({
    [IPV4_BOOTSTRAP]: {
      services: [[["198.51.100.0/22"], ["https://rdap.example-registry.test/"]]],
    },
  });
  expect(await resolveRdapBase("8.8.8.8", http)).toBeNull();
});

test("queryRdap addresses an IPv6 target through the ip path segment", async () => {
  let requestedUrl: string | undefined;
  const http: HttpClient = {
    async request({ url }) {
      requestedUrl = url;
      return { status: 200, json: async () => ({}) };
    },
  };
  await queryRdap("2001:db8::1", "https://rdap.sixes.test/", http);
  expect(requestedUrl).toBe("https://rdap.sixes.test/ip/2001:db8::1");
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
