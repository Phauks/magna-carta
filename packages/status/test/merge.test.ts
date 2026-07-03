import { expect, test } from "vitest";
import { mergeSnapshot } from "../src/merge.ts";
import type { AuthoredSnapshot, DerivedSnapshot } from "../src/schema.ts";

const NOW = "2026-07-02T00:10:00.000Z";
const derived: DerivedSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-02T00:09:00.000Z",
  components: [
    {
      id: "api",
      name: "API",
      group: "Core",
      status: "operational",
      source: "probe",
      lastChange: NOW,
    },
    {
      id: "ocr",
      name: "OCR",
      group: "Engines",
      status: "operational",
      source: "telemetry",
      lastChange: NOW,
    },
  ],
  providers: [
    {
      id: "cloudflare",
      name: "Cloudflare",
      status: "operational",
      upstreamUrl: "u",
      fetchedAt: NOW,
      reachable: true,
    },
    {
      id: "github",
      name: "GitHub",
      status: "status_unavailable",
      upstreamUrl: "u",
      fetchedAt: NOW,
      reachable: false,
    },
  ],
};
const authored: AuthoredSnapshot = {
  schemaVersion: 1,
  updatedAt: NOW,
  events: [
    {
      id: "serviceEvent_1",
      title: "OCR slow",
      impact: "minor",
      lifecycle: "investigating",
      affectedComponentIds: ["ocr"],
      authorUserId: "usr_op",
      startedAt: NOW,
      resolvedAt: null,
      updates: [{ at: NOW, lifecycle: "investigating", body: "looking", authorUserId: "usr_op" }],
    },
  ],
  overrides: [
    { componentId: "ocr", status: "degraded", note: "manual", setAt: NOW, authorUserId: "usr_op" },
  ],
};

test("an operator override wins over the derived component status", () => {
  const pub = mergeSnapshot(derived, authored, {
    audience: "internal",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  expect(pub.components.find((c) => c.id === "ocr")?.status).toBe("degraded");
});

test("overall reflects the worst component + active event impact, ignoring status_unavailable providers", () => {
  const pub = mergeSnapshot(derived, authored, {
    audience: "internal",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  // ocr override degraded + event impact minor->degraded => overall degraded (github unavailable ignored).
  expect(pub.overall).toBe("degraded");
});

test("public audience strips every authorUserId; internal keeps it", () => {
  const pub = mergeSnapshot(derived, authored, {
    audience: "public",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  expect(pub.events[0]?.authorUserId).toBeUndefined();
  expect(pub.events[0]?.updates[0]?.authorUserId).toBeUndefined();
  const internal = mergeSnapshot(derived, authored, {
    audience: "internal",
    now: NOW,
    stalenessThresholdMs: 600000,
  });
  expect(internal.events[0]?.authorUserId).toBe("usr_op");
});

test("stale is set when generatedAt is older than the threshold", () => {
  const old = { ...derived, generatedAt: "2026-07-02T00:00:00.000Z" };
  const pub = mergeSnapshot(old, authored, {
    audience: "public",
    now: NOW,
    stalenessThresholdMs: 300000,
  });
  expect(pub.stale).toBe(true);
});
