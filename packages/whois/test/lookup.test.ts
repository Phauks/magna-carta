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
