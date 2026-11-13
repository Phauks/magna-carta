import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { buildSafeDeliveryHeaders } from "../../src/files/preview-headers.ts";
import { mintPreviewDeliveryToken } from "../../src/files/preview-token.ts";

describe("cookieless preview surface — standing fitness guard", () => {
  it("registers the cookieless route exactly once", () => {
    const app = createApp();
    const matches = app.routes.filter((r) => r.path === "/api/files-preview/:token");
    expect(matches.length).toBe(1);
  });

  it("never emits Content-Disposition: inline from the header builder", () => {
    const h = buildSafeDeliveryHeaders({
      sniffedContentType: "video/mp4",
      frameAncestors: "https://*.example.com",
    });
    expect(h.get("Content-Disposition")).toBe("attachment");
  });

  it("a valid playable token serves 200 with frame-ancestors over the app's host (any branded firm subdomain may embed)", async () => {
    // The frame-ancestors source is the app's host (APP_BASE_URL) and a wildcard over it, never the
    // files host's own domain, which is a separate registrable domain from the app — branded per-firm
    // subdomains (<firm>.<app host>) must be able to embed the rendition. The signed firm-scoped
    // token is the authorization gate, so the wildcard cannot cross tenants.
    const filesOrigin = env.FILES_ORIGIN;
    if (filesOrigin === undefined) throw new Error("test env must set FILES_ORIGIN");
    const r2Key = "files/happy/v1";
    await env.R2.put(r2Key, "preview-bytes-abc");
    const token = await mintPreviewDeliveryToken(env.AUTH_SECRET, {
      r2Key,
      bucket: "test-bucket",
      sniffedContentType: "video/mp4",
      verdict: "playable",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const res = await SELF.fetch(`https://${filesOrigin}/api/files-preview/${token}`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const appHost = new URL(env.APP_BASE_URL ?? "").hostname;
    expect(csp).toContain(`frame-ancestors https://${appHost} https://*.${appHost}`);
    expect(csp).not.toContain(filesOrigin.replace(/^[^.]+\./, ""));
    // No single fixed app host is baked into the policy.
    expect(csp).not.toContain("//app.");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
  });

  it("grants CORS read access to the app's own pages, and to nobody else", async () => {
    const filesOrigin = env.FILES_ORIGIN;
    if (filesOrigin === undefined) throw new Error("test env must set FILES_ORIGIN");
    const r2Key = "files/cors/v1";
    await env.R2.put(r2Key, "preview-bytes-cors");
    const token = await mintPreviewDeliveryToken(env.AUTH_SECRET, {
      r2Key,
      bucket: "test-bucket",
      sniffedContentType: "video/mp4",
      verdict: "playable",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const appPage = `https://smith-law.${new URL(env.APP_BASE_URL ?? "").hostname}`;
    const ours = await SELF.fetch(`https://${filesOrigin}/api/files-preview/${token}`, {
      headers: { Origin: appPage, Range: "bytes=0-3" },
    });
    expect(ours.status).toBe(206);
    expect(ours.headers.get("Access-Control-Allow-Origin")).toBe(appPage);
    await ours.arrayBuffer();
    const theirs = await SELF.fetch(`https://${filesOrigin}/api/files-preview/${token}`, {
      headers: { Origin: "https://elsewhere.test" },
    });
    expect(theirs.headers.get("Access-Control-Allow-Origin")).toBeNull();
    await theirs.arrayBuffer();
    // A page on the files host's own domain (an open document in the editor) is not the app.
    const editor = await SELF.fetch(`https://${filesOrigin}/api/files-preview/${token}`, {
      headers: { Origin: `https://doc1.${filesOrigin.replace(/^[^.]+\./, "")}` },
    });
    expect(editor.headers.get("Access-Control-Allow-Origin")).toBeNull();
    await editor.arrayBuffer();
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

  it("seals the files host: /api/health and /api/auth/* return the bare 404, not their real handlers", async () => {
    // The cookieless files origin must serve ONLY the preview route or a bare 404 — never the health
    // endpoint, and never Better Auth (a credential/authentication surface must not exist on files.*).
    // The files-host catch-all is registered before every other route so this holds order-independently;
    // this guard fails if a future route is registered ahead of it and starts answering on files.*.
    const health = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/health`);
    expect(health.status).toBe(404);
    expect(await health.text()).not.toMatch(/error_/);
    expect(health.headers.get("Content-Disposition")).toBe("attachment");

    const auth = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/auth/get-session`, {
      method: "POST",
    });
    expect(auth.status).toBe(404);
    const authBody = await auth.text();
    expect(authBody).not.toMatch(/error_/);
    // Better Auth must NOT have run on files.* — no auth JSON, no session cookie minted there.
    expect(authBody).not.toMatch(/session|INVALID_/i);
    expect(auth.headers.get("set-cookie")).toBeNull();
    expect(auth.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("a header-unsafe (CRLF) Content-Type in a directly-minted token returns a bare 404, never a 500/error_", async () => {
    // decidePreview already refuses to mint an inline grant for a header-unsafe sniffed type; this proves
    // the edge-local backstop. Even a token minted by other means (the forward transcode-rendition seam)
    // whose Content-Type would make Headers.set throw must degrade to the bare 404 — the cookieless edge
    // must never throw into the telemetry boundary and emit an error_ id on the untrusted host.
    const r2Key = "files/headersafe/v1";
    await env.R2.put(r2Key, "preview-bytes");
    const token = await mintPreviewDeliveryToken(env.AUTH_SECRET, {
      r2Key,
      bucket: "test-bucket",
      sniffedContentType: "video/mp4\r\nSet-Cookie: pwned=1",
      verdict: "playable",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/files-preview/${token}`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toMatch(/error_/);
    expect(res.headers.get("Content-Type")).not.toContain("application/problem+json");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});
