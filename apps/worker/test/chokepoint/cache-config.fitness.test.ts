// Fitness guard: this Worker's default entrypoint must never have an edge cache in front of it.
//
// Enabling Workers Cache is a one-line config change (`"cache": { "enabled": true }`), and nothing
// in the request path warns that the responses behind it are tenant-scoped. An edge cache keys on
// entrypoint + path + query + version — not on the host, and not on the `Cookie` header this Worker
// resolves the firm from — so one firm's `/api/v1/*` reply would be served to the next firm that
// requests the same path. The chokepoint's `private, no-store` stamp (src/chokepoint/cache-control.ts)
// keeps a cached entry from ever being STORED; this guard keeps the cache from being turned on in
// the first place, so the two defenses are independent.
//
// Caching an API response is not forbidden outright — it requires the gateway shape: an uncached
// default entrypoint that authenticates, forwarding to a cached named entrypoint through ctx.exports
// with firmId in ctx.props (ctx.props IS part of the cache key and a caller cannot forge it). That
// shape declares per-entrypoint `exports`, which this guard permits; it only rejects caching the
// default entrypoint, where the firm lives in a cookie the cache cannot see. Rules:
// docs/conventions/security.md (response cache-control).
import { describe, expect, it } from "vitest";
import wranglerConfigContent from "../../wrangler.jsonc?raw";

// The config is JSONC (trailing commas + `//` comments), which JSON.parse rejects. Rather than pull
// in a parser, assert on the source text: any `cache` key at all is the thing a reviewer must see.
function hasCacheConfiguration(source: string): boolean {
  return /"cache"\s*:/.test(source);
}

describe("wrangler.jsonc — no edge cache in front of the default entrypoint", () => {
  it("declares no cache configuration", () => {
    expect(
      hasCacheConfiguration(wranglerConfigContent),
      "apps/worker/wrangler.jsonc declares a `cache` key. This Worker resolves the firm from the " +
        "session cookie, which is NOT part of the edge cache key — enabling caching on the default " +
        "entrypoint serves one firm's /api/v1 responses to another. If you are adding the gateway " +
        "pattern (uncached default entrypoint → cached named entrypoint keyed by ctx.props.firmId), " +
        "update this guard to assert `exports.default.cache.enabled === false` instead of removing " +
        "it. See docs/conventions/security.md (response cache-control).",
    ).toBe(false);
  });
});
