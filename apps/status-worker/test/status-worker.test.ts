import { env, SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";

const NOW = "2026-07-02T00:00:00.000Z";

beforeEach(async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.derived);
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
});

test("status.json is unauthenticated and merges both keys into a public snapshot", async () => {
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.derived,
    JSON.stringify({
      schemaVersion: 1, generatedAt: NOW,
      components: [{ id: "api", name: "API", group: "Core", status: "operational", source: "probe", lastChange: NOW }],
      providers: [],
    }),
  );
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.authored,
    JSON.stringify({
      schemaVersion: 1, updatedAt: NOW,
      events: [{ id: "serviceEvent_1", title: "x", impact: "minor", lifecycle: "investigating", affectedComponentIds: [], authorUserId: "usr_secret", startedAt: NOW, resolvedAt: null, updates: [{ at: NOW, lifecycle: "investigating", body: "y", authorUserId: "usr_secret" }] }],
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

test("isolation: the worker binds only STATUS_KV, never the app D1 / R2 / per-firm bindings", () => {
  // Fate-isolation is the whole point — a leaked app/D1 binding would let the status page share
  // the app's failure modes. Miniflare exposes exactly the wrangler-declared bindings on env.
  expect((env as Record<string, unknown>).STATUS_KV).toBeDefined();
  expect((env as Record<string, unknown>).DB_CONTROL).toBeUndefined();
  expect((env as Record<string, unknown>).R2).toBeUndefined();
});
