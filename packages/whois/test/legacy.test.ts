import { expect, test } from "vitest";
import { whoisHostForTld, queryLegacy } from "../src/legacy.ts";
import type { WhoisSocket } from "../src/types.ts";

const AT = "2026-07-09T12:00:00.000Z";

test("maps the four genuinely port-43-only ccTLDs to their hosts", () => {
  expect(whoisHostForTld("de")).toBe("whois.denic.de");
  expect(whoisHostForTld("eu")).toBe("whois.eu");
  expect(whoisHostForTld("it")).toBe("whois.nic.it");
  expect(whoisHostForTld("be")).toBe("whois.dns.be");
  expect(whoisHostForTld("zz")).toBeNull();
});

test("nl and fr are no longer in the port-43 table — both now publish RDAP", () => {
  // Removed 2026-07-09: rdap.sidn.nl / rdap.nic.fr are in the IANA bootstrap, so these resolve via
  // RDAP and never reach the legacy path.
  expect(whoisHostForTld("nl")).toBeNull();
  expect(whoisHostForTld("fr")).toBeNull();
});

test("queryLegacy returns verbatim registry text marked timezone-unspecified", async () => {
  const socket: WhoisSocket = {
    async query(host, request) {
      expect(host).toBe("whois.dns.be");
      expect(request).toContain("example.be");
      // DNS Belgium reports a REGISTERED domain as "Status: NOT AVAILABLE" — normalising it would
      // print the opposite of the truth, which is exactly why the text is never parsed.
      return "Domain:\texample.be\nStatus:\tNOT AVAILABLE\nRegistered:\tWed Jun 13 2012\n";
    },
  };
  const result = await queryLegacy("example.be", socket, AT);
  expect(result.kind).toBe("legacy");
  expect(result.source).toBe("whois-43");
  expect(result.timezoneUnspecified).toBe(true);
  expect(result.raw).toContain("Status:\tNOT AVAILABLE");
  expect(result.provenance).toEqual({
    target: "example.be",
    retrievedAt: AT,
    respondingServer: "whois.dns.be",
  });
});

test("queryLegacy throws for a TLD with no known port-43 host", async () => {
  const socket: WhoisSocket = {
    async query() {
      return "";
    },
  };
  await expect(queryLegacy("example.zz", socket, AT)).rejects.toThrow(/No port-43 WHOIS host/);
});
