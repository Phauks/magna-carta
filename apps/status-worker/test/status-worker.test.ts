import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import wranglerConfigContent from "../wrangler.jsonc?raw";
import { fallbackResponse } from "../src/index.ts";
import { FONT_ASSET_PATH, STYLES_ASSET_PATH } from "../src/page-styles.ts";

const NOW = "2026-07-02T00:00:00.000Z";

beforeEach(async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.derived);
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
  await env.STATUS_KV.delete(STATUS_KV_KEYS.history);
});

test("status.json is unauthenticated and merges both keys into a public snapshot", async () => {
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.derived,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: NOW,
      components: [
        {
          id: "api",
          name: "API",
          group: "Core",
          status: "operational",
          source: "probe",
          lastChange: NOW,
        },
      ],
      providers: [],
    }),
  );
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.authored,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: NOW,
      events: [
        {
          id: "serviceEvent_1",
          title: "x",
          impact: "minor",
          lifecycle: "investigating",
          affectedComponentIds: [],
          authorUserId: "usr_secret",
          startedAt: NOW,
          resolvedAt: null,
          updates: [{ at: NOW, lifecycle: "investigating", body: "y", authorUserId: "usr_secret" }],
        },
      ],
      overrides: [],
    }),
  );
  const response = await SELF.fetch("https://status.example.com/api/status.json");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.overall).toBeDefined();
  // The public feed must NEVER carry an operator identity.
  expect(JSON.stringify(body)).not.toContain("usr_secret");
});

test("an empty store still serves a valid operational snapshot (no 500)", async () => {
  const response = await SELF.fetch("https://status.example.com/api/status.json");
  expect(response.status).toBe(200);
  expect((await response.json()).overall).toBe("operational");
});

test("a corrupt history document degrades to no-data rather than a 500", async () => {
  await env.STATUS_KV.put(STATUS_KV_KEYS.history, "{ not json");
  const response = await SELF.fetch("https://status.example.com/api/status.json");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.overall).toBe("operational");
  expect(body.history.windowDays).toBe(90);
});

// Caching this worker's entrypoint is safe only because every response is identical for every
// reader. These tests hold the two properties that keeps true: the cacheable responses say how long
// they may be held, and the responses that are NOT snapshots refuse storage outright — because with
// the cache on, a response with no Cache-Control is cached anyway under heuristic freshness (a 200
// for two hours). Rules: docs/conventions/security.md (response cache-control).
describe("edge cache", () => {
  test("the wrangler config enables caching and keeps the version in the cache key", () => {
    expect(/"cache"\s*:\s*\{\s*"enabled"\s*:\s*true/.test(wranglerConfigContent)).toBe(true);
    // cross_version_cache would let a superseded version's page outlive its deploy. Never here:
    // this page's whole value is that it reflects the code and data that are live right now.
    // Matched as a config key, not as a word — the block above it explains why it is absent.
    expect(/"cross_version_cache"\s*:/.test(wranglerConfigContent)).toBe(false);
  });

  test("the page and the feed are cacheable for 30s, with a stale window and purge tags", async () => {
    const page = await SELF.fetch("https://status.example.com/");
    expect(page.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=600",
    );
    expect(page.headers.get("cache-tag")).toBe("status-snapshot,status-page");

    const feed = await SELF.fetch("https://status.example.com/api/status.json");
    expect(feed.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=600",
    );
    expect(feed.headers.get("cache-tag")).toBe("status-snapshot,status-feed");

    // Tags must be ASCII and space-free or they are silently dropped at storage time.
    for (const tags of [page.headers.get("cache-tag"), feed.headers.get("cache-tag")]) {
      expect(tags).toMatch(/^[\x21-\x7e]+$/);
    }
  });

  test("every non-snapshot response explicitly refuses to be stored", async () => {
    // The fallback is a 200. Cached under heuristic freshness it would pin "temporarily
    // unavailable" at the edge for two hours, outliving the failure that produced it.
    expect(fallbackResponse().headers.get("cache-control")).toBe("no-store");
    expect(fallbackResponse().status).toBe(200);

    const notFound = await SELF.fetch("https://status.example.com/nope");
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("cache-control")).toBe("no-store");

    const notAllowed = await SELF.fetch("https://status.example.com/", { method: "POST" });
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.headers.get("cache-control")).toBe("no-store");
  });

  test("no response leaves this worker without an explicit cache directive", async () => {
    const paths = ["/", "/api/status.json", STYLES_ASSET_PATH, FONT_ASSET_PATH, "/nope"];
    for (const path of paths) {
      const response = await SELF.fetch(`https://status.example.com${path}`);
      expect(response.headers.get("cache-control"), `${path} has no cache-control`).not.toBeNull();
    }
  });
});

test("isolation: the worker binds only STATUS_KV, never the app D1 / R2 / per-firm bindings", () => {
  // Fate-isolation is the whole point — a leaked app/D1 binding would let the status page share
  // the app's failure modes. Miniflare exposes exactly the wrangler-declared bindings on env.
  expect((env as Record<string, unknown>).STATUS_KV).toBeDefined();
  expect((env as Record<string, unknown>).DB_CONTROL).toBeUndefined();
  expect((env as Record<string, unknown>).R2).toBeUndefined();
});
