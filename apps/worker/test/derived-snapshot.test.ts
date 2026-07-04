import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { STATUS_KV_KEYS } from "@magna-carta/status";
import { buildAndStoreDerivedSnapshot } from "../src/status/derived-snapshot.ts";

test("the cron builder writes a derived snapshot with components and providers", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: { indicator: "none" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const snapshot = await buildAndStoreDerivedSnapshot(env, "2026-07-02T00:00:00.000Z", fetchImpl);
  expect(snapshot.components.length).toBeGreaterThan(0);
  expect(snapshot.providers.some((p) => p.id === "cloudflare")).toBe(true);
  const stored = JSON.parse((await env.STATUS_KV.get(STATUS_KV_KEYS.derived)) ?? "null");
  expect(stored.schemaVersion).toBe(1);
  // R2.head on a missing key still proves the bucket reachable (see the R2.head empirical-behavior
  // test below) — the object-storage probe reads that reachability as ok:true, so the component
  // must land operational rather than major_outage.
  const objectStorage = snapshot.components.find((component) => component.id === "object-storage");
  expect(objectStorage?.status).toBe("operational");
});

test("R2.head on a missing key resolves to null rather than throwing under Miniflare", async () => {
  const result = await env.R2.head("__status_probe_does_not_exist__");
  expect(result).toBeNull();
});
