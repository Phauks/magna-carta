import { expect, test } from "vitest";
import { resolveRdapBase, queryRdap } from "../src/rdap.ts";
import type { DomainRegistration, IpNetworkRegistration } from "../src/types.ts";
import type { HttpClient } from "@magna-carta/integrations/http";

const AT = "2026-07-09T12:00:00.000Z";

function fakeHttp(routes: Record<string, { status?: number; body: unknown }>): HttpClient {
  return {
    async request({ url }) {
      const route = routes[url];
      if (route === undefined) return { status: 404, json: async () => ({}) };
      return { status: route.status ?? 200, json: async () => route.body };
    },
  };
}

// A domain object narrowed after asserting kind, so the tests read the domain-specific fields.
async function domain(base: string, target: string, http: HttpClient): Promise<DomainRegistration> {
  const result = await queryRdap(target, base, http, AT);
  if (result.kind !== "domain") throw new Error(`expected a domain result, got ${result.kind}`);
  return result;
}

async function ip(base: string, target: string, http: HttpClient): Promise<IpNetworkRegistration> {
  const result = await queryRdap(target, base, http, AT);
  if (result.kind !== "ip") throw new Error(`expected an ip result, got ${result.kind}`);
  return result;
}

test("resolveRdapBase reports 'found' with the base URL for a TLD", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": {
      body: { services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]]] },
    },
  });
  expect(await resolveRdapBase("example.com", http)).toEqual({
    outcome: "found",
    base: "https://rdap.verisign.com/com/v1/",
  });
});

test("resolveRdapBase reports 'noRdapForTld' for a TLD absent from the bootstrap", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": {
      body: { services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] },
    },
  });
  expect(await resolveRdapBase("example.xn--unknown", http)).toEqual({ outcome: "noRdapForTld" });
});

test("resolveRdapBase reports 'transportFailure' when the bootstrap fetch is non-200", async () => {
  const http = fakeHttp({
    "https://data.iana.org/rdap/dns.json": { status: 503, body: {} },
  });
  const resolution = await resolveRdapBase("example.com", http);
  expect(resolution.outcome).toBe("transportFailure");
  if (resolution.outcome === "transportFailure") expect(resolution.status).toBe(503);
});

test("queryRdap maps a full domain object, retaining provenance and the raw body", async () => {
  const body = {
    handle: "2336799_DOMAIN_COM-VRSN",
    ldhName: "EXAMPLE.COM",
    unicodeName: "example.com",
    status: ["client transfer prohibited", "active"],
    port43: "whois.verisign-grs.com",
    rdapConformance: ["rdap_level_0", "icann_rdap_response_profile_0"],
    secureDNS: { delegationSigned: true, dsData: [{ keyTag: 30909, algorithm: 8, digestType: 2 }] },
    nameservers: [
      { ldhName: "a.iana-servers.net", ipAddresses: { v4: ["199.43.135.53"], v6: ["2001:500:8f::53"] } },
      { ldhName: "b.iana-servers.net" },
    ],
    events: [
      { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
      { eventAction: "expiration", eventDate: "2026-08-13T04:00:00Z" },
      { eventAction: "last changed", eventDate: "2025-08-14T07:01:44Z" },
      { eventAction: "transfer", eventDate: "2019-09-09T15:39:04Z" },
      { eventAction: "last update of RDAP database", eventDate: "2026-07-09T11:59:00Z" },
    ],
    entities: [
      {
        roles: ["registrar"],
        publicIds: [{ type: "IANA Registrar ID", identifier: "376" }],
        vcardArray: ["vcard", [["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]],
        entities: [
          {
            roles: ["abuse"],
            vcardArray: [
              "vcard",
              [
                ["email", {}, "text", "abuse@iana.org"],
                ["tel", {}, "uri", "tel:+1.7303555555"],
              ],
            ],
          },
        ],
      },
    ],
    remarks: [{ title: "Terms of Use", description: ["Service subject to terms."] }],
    notices: [{ title: "Status Codes", description: ["For more information on status codes…"] }],
  };
  const http = fakeHttp({ "https://rdap.verisign.com/com/v1/domain/example.com": { body } });
  const result = await domain("https://rdap.verisign.com/com/v1/", "example.com", http);

  expect(result.provenance).toEqual({
    target: "example.com",
    retrievedAt: AT,
    respondingServer: "https://rdap.verisign.com/com/v1/",
  });
  expect(result.handle).toBe("2336799_DOMAIN_COM-VRSN");
  expect(result.ldhName).toBe("EXAMPLE.COM");
  expect(result.unicodeName).toBe("example.com");
  expect(result.statuses).toEqual(["client transfer prohibited", "active"]);
  expect(result.port43).toBe("whois.verisign-grs.com");
  expect(result.rdapConformance).toContain("icann_rdap_response_profile_0");
  expect(result.secureDns).toEqual({
    delegationSigned: true,
    dsData: [{ keyTag: 30909, algorithm: 8, digestType: 2, digest: undefined }],
  });
  expect(result.registrar).toEqual({
    state: "present",
    value: { name: "RESERVED-Internet Assigned Numbers Authority", ianaId: "376" },
  });
  expect(result.abuse).toEqual({
    state: "present",
    value: { email: "abuse@iana.org", phone: "tel:+1.7303555555" },
  });
  expect(result.nameservers).toEqual({
    state: "present",
    value: [
      { ldhName: "a.iana-servers.net", ipv4: ["199.43.135.53"], ipv6: ["2001:500:8f::53"] },
      { ldhName: "b.iana-servers.net" },
    ],
  });
  // All five events retained, including transfer and last-update — not just the original three.
  expect(result.events?.map((e) => e.action)).toEqual([
    "registration",
    "expiration",
    "last changed",
    "transfer",
    "last update of RDAP database",
  ]);
  // The raw body is retained unmodified for the exhibit.
  expect(result.rawRdap).toEqual(body);
});

test("queryRdap displays a published registrant contact including a postal address", async () => {
  const body = {
    entities: [
      {
        roles: ["registrant"],
        vcardArray: [
          "vcard",
          [
            ["fn", {}, "text", "Jane Public"],
            ["org", {}, "text", "Public Holdings"],
            ["email", {}, "text", "jane@example.it"],
            ["tel", {}, "uri", "tel:+39.0612345678"],
            ["adr", {}, "text", ["", "", "Via Roma 1", "Roma", "RM", "00100", "Italy"]],
          ],
        ],
      },
    ],
  };
  const http = fakeHttp({ "https://rdap.nic.it/domain/example.it": { body } });
  const result = await domain("https://rdap.nic.it/", "example.it", http);
  expect(result.registrant).toEqual({
    state: "present",
    value: {
      name: "Jane Public",
      organization: "Public Holdings",
      email: "jane@example.it",
      phone: "tel:+39.0612345678",
      address: ["Via Roma 1", "Roma", "RM", "00100", "Italy"],
    },
  });
});

test("a redacted registrant and an absent one produce DIFFERENT typed values", async () => {
  const redactedBody = {
    remarks: [
      {
        title: "REDACTED FOR PRIVACY",
        type: "object redacted due to authorization",
        description: [
          "Some of the data in this object has been removed.",
          "Please query the RDDS service of the Registrar of Record.",
        ],
      },
    ],
    entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar"]]] }],
  };
  const absentBody = {
    entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar"]]] }],
  };
  const http = fakeHttp({
    "https://rdap.example/com/domain/redacted.com": { body: redactedBody },
    "https://rdap.example/com/domain/absent.com": { body: absentBody },
  });

  const withRedaction = await domain("https://rdap.example/com/", "redacted.com", http);
  const withAbsence = await domain("https://rdap.example/com/", "absent.com", http);

  expect(withRedaction.registrant).toEqual({
    state: "redacted",
    notice:
      "Some of the data in this object has been removed. Please query the RDDS service of the Registrar of Record.",
  });
  expect(withAbsence.registrant).toEqual({ state: "notProvided" });
  // The two silences are not interchangeable.
  expect(withRedaction.registrant).not.toEqual(withAbsence.registrant);
});

test("queryRdap maps an IP network object and marks registrar/nameservers not-applicable", async () => {
  const body = {
    objectClassName: "ip network",
    handle: "NET-192-0-2-0-1",
    startAddress: "192.0.2.0",
    endAddress: "192.0.2.255",
    ipVersion: "v4",
    name: "TEST-NET-1",
    type: "ALLOCATED PA",
    country: "US",
    parentHandle: "NET-192-0-0-0-0",
    cidr0_cidrs: [{ v4prefix: "192.0.2.0", length: 24 }],
    status: ["active"],
    events: [{ eventAction: "registration", eventDate: "2010-01-01T00:00:00Z" }],
    entities: [
      {
        roles: ["registrant"],
        entities: [
          {
            roles: ["abuse"],
            vcardArray: ["vcard", [["email", {}, "text", "abuse@example.net"]]],
          },
        ],
      },
    ],
  };
  const http = fakeHttp({ "https://rdap.arin.net/registry/ip/192.0.2.1": { body } });
  const result = await ip("https://rdap.arin.net/registry/", "192.0.2.1", http);

  expect(result.kind).toBe("ip");
  expect(result.startAddress).toBe("192.0.2.0");
  expect(result.endAddress).toBe("192.0.2.255");
  expect(result.ipVersion).toBe("v4");
  expect(result.name).toBe("TEST-NET-1");
  expect(result.type).toBe("ALLOCATED PA");
  expect(result.country).toBe("US");
  expect(result.parentHandle).toBe("NET-192-0-0-0-0");
  expect(result.cidr).toEqual(["192.0.2.0/24"]);
  expect(result.abuse).toEqual({ state: "present", value: { email: "abuse@example.net" } });
  // A registrar and nameservers cannot apply to an allocation — typed, not blank, so the page cannot
  // render an empty cell that reads as "no registration found".
  expect(result.registrar).toEqual({ state: "notApplicable" });
  expect(result.nameservers).toEqual({ state: "notApplicable" });
});

test("queryRdap is defensive when all optional fields are absent", async () => {
  const http = fakeHttp({ "https://rdap.example.com/domain/sparse.org": { body: {} } });
  const result = await domain("https://rdap.example.com/", "sparse.org", http);
  expect(result.handle).toBeUndefined();
  expect(result.ldhName).toBeUndefined();
  expect(result.statuses).toBeUndefined();
  expect(result.events).toBeUndefined();
  expect(result.secureDns).toBeUndefined();
  expect(result.registrar).toEqual({ state: "notProvided" });
  expect(result.abuse).toEqual({ state: "notProvided" });
  expect(result.registrant).toEqual({ state: "notProvided" });
  expect(result.nameservers).toEqual({ state: "notProvided" });
  // Even an empty response still carries provenance and a (empty) raw body.
  expect(result.provenance.retrievedAt).toBe(AT);
  expect(result.rawRdap).toEqual({});
});

test("queryRdap tolerates a malformed (non-object) body without throwing", async () => {
  const http = fakeHttp({ "https://rdap.example.com/domain/bad.org": { body: ["unexpected"] } });
  const result = await domain("https://rdap.example.com/", "bad.org", http);
  expect(result.registrar).toEqual({ state: "notProvided" });
  expect(result.registrant).toEqual({ state: "notProvided" });
  // The malformed payload is still retained verbatim as the exhibit's raw record.
  expect(result.rawRdap).toEqual(["unexpected"]);
});

test("queryRdap joins base and path without double slashes", async () => {
  let requestedUrl: string | undefined;
  const http: HttpClient = {
    async request({ url }) {
      requestedUrl = url;
      return { status: 200, json: async () => ({}) };
    },
  };
  await queryRdap("example.com", "https://rdap.verisign.com/com/v1", http, AT);
  expect(requestedUrl).toBe("https://rdap.verisign.com/com/v1/domain/example.com");
});
