import { expect, test } from "vitest";
import { whoisHostForTld, queryLegacy } from "../src/legacy.ts";
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
