import { expect, test } from "vitest";
import { lookupRegistration } from "../src/lookup.ts";
import type { WhoisDeps } from "../src/types.ts";

const bootstrap = {
  "https://data.iana.org/rdap/dns.json": { services: [[["com"], ["https://rdap.example/com/"]]] },
};

function deps(routes: Record<string, unknown>, socketText = ""): WhoisDeps {
  return {
    http: {
      async request({ url }) {
        const body = { ...bootstrap, ...routes }[url];
        return body === undefined
          ? { status: 404, json: async () => ({}) }
          : { status: 200, json: async () => body };
      },
    },
    socket: {
      async query() {
        return socketText;
      },
    },
  };
}

test("rejects a private/invalid target via the SSRF guard", async () => {
  await expect(lookupRegistration("http://127.0.0.1", deps({}))).rejects.toMatchObject({
    name: "SsrfRejection",
  });
});

test("returns RDAP result for a com domain", async () => {
  const d = deps({ "https://rdap.example/com/domain/example.com": { status: ["active"] } });
  const result = await lookupRegistration("example.com", d);
  expect(result.source).toBe("rdap");
  expect(result.target).toBe("example.com");
});

test("falls back to port-43 when the TLD has no RDAP base", async () => {
  const d = deps({}, "Domain: example.de\n");
  const result = await lookupRegistration("example.de", d);
  expect(result.source).toBe("whois-43");
});

test("walks up from a hostname to the registrable domain that actually answers", async () => {
  // Registries hold registrable domains: "www.example.com" is a 404 at the registry while
  // "example.com" is the record the member meant. The result's target names what answered.
  const d = deps({
    "https://rdap.example/com/domain/example.com": {
      status: ["active"],
      events: [{ eventAction: "registration", eventDate: "2000-01-01T00:00:00Z" }],
    },
  });
  const result = await lookupRegistration("www.example.com", d);
  expect(result.source).toBe("rdap");
  expect(result.target).toBe("example.com");
  expect(result.statuses).toEqual(["active"]);
});

test("stops walking at the two-label floor and returns the empty answer honestly", async () => {
  const d = deps({ "https://rdap.example/com/domain/unregistered-x9z.com": {} });
  const result = await lookupRegistration("sub.unregistered-x9z.com", d);
  expect(result.source).toBe("rdap");
  expect(result.target).toBe("unregistered-x9z.com");
  expect(result.registeredAt).toBeUndefined();
});
