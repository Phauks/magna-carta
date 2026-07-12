import { expect, test, vi } from "vitest";
import { lookupRegistration } from "../src/lookup.ts";
import { WhoisTransportError } from "../src/errors.ts";
import type { WhoisDeps } from "../src/types.ts";
import type { HttpClient } from "@magna-carta/integrations/http";

const AT = "2026-07-09T12:00:00.000Z";

const bootstrap = {
  "https://data.iana.org/rdap/dns.json": { services: [[["com"], ["https://rdap.example/com/"]]] },
};

// Build deps. `bootstrapStatus` lets a test simulate an IANA outage (non-200 on the bootstrap fetch).
function deps(
  routes: Record<string, unknown>,
  options: { socketText?: string; bootstrapStatus?: number; socketSpy?: WhoisSocketQuery } = {},
): WhoisDeps {
  const http: HttpClient = {
    async request({ url }) {
      if (url === "https://data.iana.org/rdap/dns.json" && options.bootstrapStatus !== undefined) {
        return { status: options.bootstrapStatus, json: async () => ({}) };
      }
      const body = { ...bootstrap, ...routes }[url];
      return body === undefined
        ? { status: 404, json: async () => ({}) }
        : { status: 200, json: async () => body };
    },
  };
  return {
    http,
    socket: { query: options.socketSpy ?? (async () => options.socketText ?? "") },
    now: () => AT,
  };
}

type WhoisSocketQuery = (host: string, request: string) => Promise<string>;

test("rejects a private/invalid target via the SSRF guard", async () => {
  await expect(lookupRegistration("http://127.0.0.1", deps({}))).rejects.toMatchObject({
    name: "SsrfRejection",
  });
});

test("returns an RDAP domain result for a com domain, stamped with the injected clock", async () => {
  const d = deps({ "https://rdap.example/com/domain/example.com": { status: ["active"] } });
  const result = await lookupRegistration("example.com", d);
  expect(result.kind).toBe("domain");
  expect(result.source).toBe("rdap");
  expect(result.provenance.target).toBe("example.com");
  expect(result.provenance.retrievedAt).toBe(AT);
  expect(result.provenance.respondingServer).toBe("https://rdap.example/com/");
});

test("falls back to port-43 when the TLD genuinely has no RDAP base", async () => {
  const result = await lookupRegistration("example.de", deps({}, { socketText: "Domain: example.de\n" }));
  expect(result.kind).toBe("legacy");
  expect(result.source).toBe("whois-43");
});

test("a bootstrap outage surfaces as a transport failure, NOT a port-43 attempt", async () => {
  const socketSpy = vi.fn<WhoisSocketQuery>(async () => "");
  // The bootstrap fetch returns 503. Previously resolveRdapBase collapsed this to null and .com fell
  // through to port 43, which throws for any TLD outside the static table (a 500). Now it must throw a
  // WhoisTransportError and never touch the socket.
  const d = deps(
    { "https://rdap.example/com/domain/example.com": { status: ["active"] } },
    { bootstrapStatus: 503, socketSpy },
  );
  await expect(lookupRegistration("example.com", d)).rejects.toBeInstanceOf(WhoisTransportError);
  expect(socketSpy).not.toHaveBeenCalled();
});
