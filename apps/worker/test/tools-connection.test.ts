/*
 * The connection route reports what the edge sees about the caller and touches no database, so
 * its round trip measures a real authenticated API call. It is gated on tools:speedTest like
 * every other tool surface.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/tools/connection", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/tools/connection");
    expect(response.status).toBe(401);
  });

  it("is registered in the emitted contract", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(document.paths["/api/v1/tools/connection"]).toBeDefined();
  });
});
