import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  // Prove the control-plane D1 binding exists and is queryable in Miniflare before exercising the route.
  await env.DB_CONTROL.prepare("SELECT 1").first();
});

describe("GET /api/health", () => {
  it("returns 200 with the typed body", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
    expect(typeof (body as { version: string }).version).toBe("string");
    expect(typeof (body as { time: string }).time).toBe("string");
  });

  it("emits an OpenAPI 3.1 document", async () => {
    const res = await SELF.fetch("https://example.com/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect((doc as { openapi: string }).openapi).toMatch(/^3\.1/);
  });
});
