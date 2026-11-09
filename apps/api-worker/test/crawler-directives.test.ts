import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { X_ROBOTS_TAG_NOINDEX } from "../src/http/crawler-directives.ts";

// Magna Carta is a private, authenticated product: every surface this Worker serves (the SPA shell,
// the API, Better Auth, and every branded per-firm subdomain) must stay out of search indexes. This
// guard fails if the directive ever stops being stamped, or if it starts leaking onto the sealed
// cookieless files host whose exhaustive header set must stay pristine.
describe("noindex crawler directive — standing fitness guard", () => {
  it("stamps X-Robots-Tag: noindex on an API response (a private app-origin surface)", async () => {
    const res = await SELF.fetch("https://app.example.com/api/health");
    expect(res.headers.get("X-Robots-Tag")).toBe(X_ROBOTS_TAG_NOINDEX);
  });

  it("stamps X-Robots-Tag: noindex on the SPA shell fallthrough", async () => {
    // The Workers Static Assets response carries immutable headers; the middleware copies it so the
    // directive lands. Asserted on the header only, not the status — the SPA build need not be present
    // in the test env for the directive to be stamped on the fallthrough.
    const res = await SELF.fetch("https://app.example.com/");
    expect(res.headers.get("X-Robots-Tag")).toBe(X_ROBOTS_TAG_NOINDEX);
  });

  it("does NOT stamp X-Robots-Tag on the sealed cookieless files host (forged token -> bare 404)", async () => {
    // The directive middleware is registered AFTER the preview route, so the files.* edge is outside
    // its chain. That host serves only attachment bytes and bare 404s — never an indexable page — and
    // its payload-derived header set must not gain headers from elsewhere.
    const filesOrigin = env.FILES_ORIGIN;
    if (filesOrigin === undefined) throw new Error("test env must set FILES_ORIGIN");
    const res = await SELF.fetch(`https://${filesOrigin}/api/files-preview/forged.token`);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("does NOT stamp X-Robots-Tag on a non-preview path on the files host", async () => {
    const filesOrigin = env.FILES_ORIGIN;
    if (filesOrigin === undefined) throw new Error("test env must set FILES_ORIGIN");
    const res = await SELF.fetch(`https://${filesOrigin}/some/other/path`);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });
});
