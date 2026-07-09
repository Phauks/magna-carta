import { expect, test } from "vitest";
import { mergeSnapshot } from "../src/merge.ts";
import { emptyHistory, type AuthoredSnapshot, type DerivedSnapshot } from "../src/schema.ts";

const NOW = "2026-07-02T00:10:00.000Z";
const HISTORY = emptyHistory(NOW);
const PUBLIC = { audience: "public", now: NOW, stalenessThresholdMs: 600000 } as const;
const INTERNAL = { audience: "internal", now: NOW, stalenessThresholdMs: 600000 } as const;
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

test("an operator override raises the derived component status", () => {
  const pub = mergeSnapshot(derived, authored, HISTORY, INTERNAL);
  expect(pub.components.find((c) => c.id === "ocr")?.status).toBe("degraded");
});

test("overall reflects the worst component + active event impact", () => {
  const pub = mergeSnapshot(derived, authored, HISTORY, INTERNAL);
  // ocr override degraded + event impact minor->degraded => overall degraded.
  expect(pub.overall).toBe("degraded");
});

test("a declared event colors the component it names, even with no override set", () => {
  // The operator declared a major event against "api" but never set an override. The row must not
  // stay green while the banner announces an outage.
  const eventOnly: AuthoredSnapshot = {
    ...authored,
    overrides: [],
    events: [
      {
        ...(authored.events[0] as AuthoredSnapshot["events"][number]),
        impact: "major",
        affectedComponentIds: ["api"],
      },
    ],
  };
  const pub = mergeSnapshot(derived, eventOnly, HISTORY, INTERNAL);
  expect(pub.components.find((c) => c.id === "api")?.status).toBe("partial_outage");
  // A component the event does not name is untouched.
  expect(pub.components.find((c) => c.id === "ocr")?.status).toBe("operational");
});

test("a resolved event no longer colors its component", () => {
  const resolved: AuthoredSnapshot = {
    ...authored,
    overrides: [],
    events: [
      {
        ...(authored.events[0] as AuthoredSnapshot["events"][number]),
        lifecycle: "resolved",
        resolvedAt: NOW,
        affectedComponentIds: ["ocr"],
      },
    ],
  };
  const pub = mergeSnapshot(derived, resolved, HISTORY, INTERNAL);
  expect(pub.components.find((c) => c.id === "ocr")?.status).toBe("operational");
  expect(pub.overall).toBe("operational");
});

test("a degraded upstream provider never sets the verdict; it raises an advisory instead", () => {
  const calm: AuthoredSnapshot = { ...authored, events: [], overrides: [] };
  const troubled: DerivedSnapshot = {
    ...derived,
    providers: [
      { ...(derived.providers[0] as DerivedSnapshot["providers"][number]), status: "major_outage" },
      ...derived.providers.slice(1),
    ],
  };
  const pub = mergeSnapshot(troubled, calm, HISTORY, PUBLIC);
  // Our probes are green, so we are operational — whatever Cloudflare says about Cloudflare.
  expect(pub.overall).toBe("operational");
  expect(pub.upstreamAdvisory?.worst).toBe("major_outage");
  expect(pub.upstreamAdvisory?.providers.map((p) => p.id)).toEqual(["cloudflare"]);
});

test("an unreachable provider feed raises no advisory at all", () => {
  const calm: AuthoredSnapshot = { ...authored, events: [], overrides: [] };
  // The fixture's github provider is status_unavailable and cloudflare is operational.
  const pub = mergeSnapshot(derived, calm, HISTORY, PUBLIC);
  expect(pub.upstreamAdvisory).toBeNull();
  expect(pub.overall).toBe("operational");
});

test("public audience strips every authorUserId; internal keeps it", () => {
  const pub = mergeSnapshot(derived, authored, HISTORY, PUBLIC);
  expect(pub.events[0]?.authorUserId).toBeUndefined();
  expect(pub.events[0]?.updates[0]?.authorUserId).toBeUndefined();
  const internal = mergeSnapshot(derived, authored, HISTORY, INTERNAL);
  expect(internal.events[0]?.authorUserId).toBe("usr_op");
});

test("stale is set when generatedAt is older than the threshold", () => {
  const old = { ...derived, generatedAt: "2026-07-02T00:00:00.000Z" };
  const pub = mergeSnapshot(old, authored, HISTORY, {
    audience: "public",
    now: NOW,
    stalenessThresholdMs: 300000,
  });
  expect(pub.stale).toBe(true);
});

test("the published history carries one entry per derived component", () => {
  const pub = mergeSnapshot(derived, authored, HISTORY, PUBLIC);
  expect(Object.keys(pub.history.components).sort()).toEqual(["api", "ocr"]);
  expect(pub.history.windowDays).toBe(90);
  expect(pub.history.components["api"]?.uptimeRatio).toBeNull();
});
