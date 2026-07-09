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

test("the cron appends one history sample per component per run", async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.history);
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: { indicator: "none" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const now = "2026-07-02T00:00:00.000Z";
  await buildAndStoreDerivedSnapshot(env, now, fetchImpl);
  await buildAndStoreDerivedSnapshot(env, now, fetchImpl);
  const history = JSON.parse((await env.STATUS_KV.get(STATUS_KV_KEYS.history)) ?? "null");
  expect(history.schemaVersion).toBe(1);
  // Two runs on the same UTC day: two samples for the always-warm api probe.
  expect(history.days["2026-07-02"].api).toEqual({ operational: 2 });
});

test("an operator's declared event colors the history sample, not just the banner", async () => {
  await env.STATUS_KV.delete(STATUS_KV_KEYS.history);
  const now = "2026-07-02T00:00:00.000Z";
  // A major event against "api" with NO component override set: the sample must record what a
  // reader would see on the row, not the bare probe result.
  await env.STATUS_KV.put(
    STATUS_KV_KEYS.authored,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: now,
      events: [
        {
          id: "serviceEvent_1",
          title: "The application is unavailable",
          impact: "major",
          lifecycle: "investigating",
          affectedComponentIds: ["api"],
          authorUserId: "usr_op",
          startedAt: now,
          resolvedAt: null,
          updates: [{ at: now, lifecycle: "investigating", body: "x", authorUserId: "usr_op" }],
        },
      ],
      overrides: [],
    }),
  );
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: { indicator: "none" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  await buildAndStoreDerivedSnapshot(env, now, fetchImpl);
  const history = JSON.parse((await env.STATUS_KV.get(STATUS_KV_KEYS.history)) ?? "null");
  expect(history.days["2026-07-02"].api).toEqual({ partial_outage: 1 });
  // A component the event never named keeps its probed status.
  expect(history.days["2026-07-02"]["object-storage"]).toEqual({ operational: 1 });
  await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
});
