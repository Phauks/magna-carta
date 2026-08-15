import { expect, test } from "vitest";
import { whoisHostForTld, queryLegacy, UnsupportedRegistry } from "../src/legacy.ts";
import type { WhoisSocket } from "../src/types.ts";

test("maps a known ccTLD to its port-43 host", () => {
  expect(whoisHostForTld("de")).toBe("whois.denic.de");
  expect(whoisHostForTld("zz")).toBeNull();
});

test("queryLegacy returns raw text labelled whois-43", async () => {
  const socket: WhoisSocket = {
    async query(host, request) {
      expect(host).toBe("whois.denic.de");
      expect(request).toContain("example.de");
      return "Domain: example.de\nStatus: connect\n";
    },
  };
  const result = await queryLegacy("example.de", socket);
  expect(result.source).toBe("whois-43");
  expect(result.raw).toContain("Domain: example.de");
});

// A registry with no RDAP entry and no port-43 host is an ordinary outcome, not a bug in the
// caller's input, so it has to be distinguishable from a genuine fault at the call site.
test("queryLegacy throws a typed UnsupportedRegistry for a registry it cannot reach", async () => {
  const socket: WhoisSocket = {
    query() {
      throw new Error("the socket must never be opened for an unsupported registry");
    },
  };
  await expect(queryLegacy("admin.ch", socket)).rejects.toBeInstanceOf(UnsupportedRegistry);
  await expect(queryLegacy("admin.ch", socket)).rejects.toMatchObject({ tld: "ch" });
});
