import { describe, expect, it } from "vitest";
import type { AddressContainerFetcher } from "../src/forward-query.ts";
import {
  ADDRESS_INDEX_MAXIMUM_AGE_MILLISECONDS,
  decideRefresh,
  indexAgeOf,
  refreshAddressIndex,
  type BuildState,
} from "../src/refresh-decision.ts";

const NOW = Date.parse("2026-10-02T07:17:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function pointerBuiltAt(milliseconds: number): string {
  return JSON.stringify({
    build: "build-1",
    builtAt: new Date(milliseconds).toISOString(),
    documentCount: 1,
    partitions: {},
    attribution: "us/build-1/attribution.json",
  });
}

describe("the index's age", () => {
  it("is stale with no pointer", () => {
    expect(indexAgeOf(null, NOW)).toBe("stale");
  });

  it("is fresh inside thirty days, including exactly thirty", () => {
    expect(indexAgeOf(pointerBuiltAt(NOW - DAY), NOW)).toBe("fresh");
    expect(indexAgeOf(pointerBuiltAt(NOW - ADDRESS_INDEX_MAXIMUM_AGE_MILLISECONDS), NOW)).toBe(
      "fresh",
    );
  });

  it("is stale past thirty days", () => {
    expect(indexAgeOf(pointerBuiltAt(NOW - 31 * DAY), NOW)).toBe("stale");
  });

  it("is stale when the pointer cannot vouch for itself", () => {
    for (const text of ["not json", "{}", '{"builtAt":12}', '{"builtAt":"yesterday"}', "null"]) {
      expect(indexAgeOf(text, NOW), text).toBe("stale");
    }
  });
});

describe("the decision", () => {
  it("does nothing while the index is fresh, whatever the build container would say", () => {
    for (const buildState of ["idle", "running", "failed"] as const) {
      expect(decideRefresh({ indexAge: "fresh", buildState })).toBe("fresh");
    }
  });

  it("starts a build for a stale or missing index when nothing is building", () => {
    expect(decideRefresh({ indexAge: "stale", buildState: "idle" })).toBe("start");
  });

  it("lets a running build finish", () => {
    expect(decideRefresh({ indexAge: "stale", buildState: "running" })).toBe("running");
  });

  it("retries after a failed build", () => {
    expect(decideRefresh({ indexAge: "stale", buildState: "failed" })).toBe("start");
  });
});

function fakeBuildContainer(state: BuildState | "broken", startStatus = 202) {
  const seen: { method: string; path: string; body: string }[] = [];
  const container: AddressContainerFetcher = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      seen.push({ method: request.method, path, body: await request.text() });
      if (request.method === "GET" && path === "/builds") {
        return state === "broken"
          ? new Response("down", { status: 500 })
          : Response.json({ state, startedAt: null, finishedAt: null, detail: null });
      }
      if (request.method === "POST" && path === "/builds") {
        return Response.json(
          { build: startStatus === 202 ? "started" : "running" },
          { status: startStatus },
        );
      }
      return new Response(null, { status: 404 });
    },
  };
  return { container, seen };
}

describe("the daily check", () => {
  it("reads only the pointer when the index is fresh, and never wakes the build container", async () => {
    const { container, seen } = fakeBuildContainer("idle");
    const decision = await refreshAddressIndex({
      readPointer: () => Promise.resolve(pointerBuiltAt(NOW - 2 * DAY)),
      buildContainer: container,
      now: NOW,
    });
    expect(decision).toBe("fresh");
    expect(seen).toEqual([]);
  });

  it("starts a United States build when there is no pointer", async () => {
    const { container, seen } = fakeBuildContainer("idle");
    const decision = await refreshAddressIndex({
      readPointer: () => Promise.resolve(null),
      buildContainer: container,
      now: NOW,
    });
    expect(decision).toBe("start");
    expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /builds",
      "POST /builds",
    ]);
    expect(JSON.parse(seen[1]?.body ?? "")).toEqual({ country: "US" });
  });

  it("starts a build when the index is stale and the last one failed", async () => {
    const { container, seen } = fakeBuildContainer("failed");
    const decision = await refreshAddressIndex({
      readPointer: () => Promise.resolve(pointerBuiltAt(NOW - 45 * DAY)),
      buildContainer: container,
      now: NOW,
    });
    expect(decision).toBe("start");
    expect(seen.at(-1)?.method).toBe("POST");
  });

  it("does not start a second build while one is running", async () => {
    const { container, seen } = fakeBuildContainer("running");
    const decision = await refreshAddressIndex({
      readPointer: () => Promise.resolve(pointerBuiltAt(NOW - 45 * DAY)),
      buildContainer: container,
      now: NOW,
    });
    expect(decision).toBe("running");
    expect(seen.map(({ method }) => method)).toEqual(["GET"]);
  });

  it("accepts losing the race to a build that started in between", async () => {
    const { container } = fakeBuildContainer("idle", 409);
    await expect(
      refreshAddressIndex({
        readPointer: () => Promise.resolve(null),
        buildContainer: container,
        now: NOW,
      }),
    ).resolves.toBe("start");
  });

  it("fails loudly when the build container cannot say what it is doing", async () => {
    const { container, seen } = fakeBuildContainer("broken");
    await expect(
      refreshAddressIndex({
        readPointer: () => Promise.resolve(null),
        buildContainer: container,
        now: NOW,
      }),
    ).rejects.toThrow(/status 500/);
    expect(seen.map(({ method }) => method)).toEqual(["GET"]);
  });

  it("fails loudly when a build cannot be started", async () => {
    const { container } = fakeBuildContainer("idle", 500);
    await expect(
      refreshAddressIndex({
        readPointer: () => Promise.resolve(null),
        buildContainer: container,
        now: NOW,
      }),
    ).rejects.toThrow(/status 500/);
  });
});
