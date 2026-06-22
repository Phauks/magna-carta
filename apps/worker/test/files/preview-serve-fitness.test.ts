import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { buildSafeDeliveryHeaders } from "../../src/files/preview-headers.ts";

describe("cookieless preview surface — standing fitness guard", () => {
  it("registers the cookieless route exactly once", () => {
    const app = createApp();
    const matches = app.routes.filter((r) => r.path === "/api/files-preview/:token");
    expect(matches.length).toBe(1);
  });

  it("never emits Content-Disposition: inline from the header builder", () => {
    const h = buildSafeDeliveryHeaders({ sniffedContentType: "video/mp4", appOrigin: "https://app.example.com" });
    expect(h.get("Content-Disposition")).toBe("attachment");
  });

  it("a non-preview path on the files host does not leak the SPA shell", async () => {
    const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/some/other/path`);
    const body = await res.text();
    expect(body).not.toContain("<!doctype html");
    expect(body).not.toContain("<html");
  });

  it("a forged token on the files host returns a bare 404 with no error_ id / correlation surface, no ACAO", async () => {
    const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/files-preview/forged.token`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toMatch(/error_/);
    expect(res.headers.get("correlation-id")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).not.toContain("application/problem+json");
  });

  it("the preview path on a non-files host returns the bare 404, not a privileged handler", async () => {
    const res = await SELF.fetch("https://example.com/api/files-preview/anything");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toMatch(/error_/);
  });
});
