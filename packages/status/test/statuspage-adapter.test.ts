import { expect, test } from "vitest";
import {
  normalizeStatuspageComponentStatus,
  normalizeStatuspageIndicator,
  pollStatuspageProvider,
  type StatuspageSummary,
  statuspageSeverity,
} from "../src/statuspage-adapter.ts";
import { PROVIDER_REGISTRY } from "../src/provider-registry.ts";

const NOW = "2026-07-02T00:00:00.000Z";
const DEF = {
  id: "cloudflare",
  name: "Cloudflare",
  kind: "statuspage" as const,
  feedUrl: "https://x/api/v2/summary.json",
};

// The shape that produced the bug this scoping exists for: every service component healthy, no
// incidents, a few edge locations re-routed — and a whole-page indicator of "minor" regardless.
// Trimmed from a live www.cloudflarestatus.com/api/v2/summary.json response.
function cloudflareLikeSummary(overrides: Partial<StatuspageSummary> = {}): StatuspageSummary {
  return {
    status: { indicator: "minor", description: "Minor Service Outage" },
    components: [
      { id: "services", name: "Cloudflare Sites and Services", status: "operational", group: true },
      { id: "workers", name: "Workers", status: "operational", group: false, group_id: "services" },
      { id: "d1", name: "D1", status: "operational", group: false, group_id: "services" },
      { id: "r2", name: "R2", status: "operational", group: false, group_id: "services" },
      { id: "europe", name: "Europe", status: "partial_outage", group: true },
      { id: "lys", name: "Lyon, France - (LYS)", status: "partial_outage", group_id: "europe" },
      { id: "kbp", name: "Kyiv, Ukraine - (KBP)", status: "under_maintenance", group_id: "europe" },
    ],
    incidents: [],
    ...overrides,
  };
}

const CLOUDFLARE_SCOPE = ["Cloudflare Sites and Services"];

test("normalizes every Statuspage indicator", () => {
  expect(normalizeStatuspageIndicator("none")).toBe("operational");
  expect(normalizeStatuspageIndicator("minor")).toBe("degraded");
  expect(normalizeStatuspageIndicator("major")).toBe("partial_outage");
  expect(normalizeStatuspageIndicator("critical")).toBe("major_outage");
  expect(normalizeStatuspageIndicator("gibberish")).toBe("degraded");
});

test("normalizes every Statuspage component status, pessimistically on the unknown", () => {
  expect(normalizeStatuspageComponentStatus("operational")).toBe("operational");
  expect(normalizeStatuspageComponentStatus("under_maintenance")).toBe("maintenance");
  expect(normalizeStatuspageComponentStatus("degraded_performance")).toBe("degraded");
  expect(normalizeStatuspageComponentStatus("partial_outage")).toBe("partial_outage");
  expect(normalizeStatuspageComponentStatus("major_outage")).toBe("major_outage");
  expect(normalizeStatuspageComponentStatus("something_new")).toBe("degraded");
});

test("without a scope the whole-page indicator is the verdict", () => {
  expect(statuspageSeverity(cloudflareLikeSummary(), undefined)).toBe("degraded");
  expect(statuspageSeverity({ status: { indicator: "none" } }, undefined)).toBe("operational");
});

test("a scoped provider ignores components outside the named groups", () => {
  // The regression: re-routed edge locations drag the page indicator to "minor" while every service
  // this platform runs on is healthy. Reporting "degraded" there contradicts the provider's own page.
  expect(statuspageSeverity(cloudflareLikeSummary(), CLOUDFLARE_SCOPE)).toBe("operational");
});

test("a scoped provider still reports trouble inside the named groups", () => {
  const summary = cloudflareLikeSummary();
  const components = [...(summary.components ?? [])].map((component) =>
    component.id === "r2" ? { ...component, status: "major_outage" } : component,
  );
  expect(statuspageSeverity({ ...summary, components }, CLOUDFLARE_SCOPE)).toBe("major_outage");
});

test("a scoped provider reports maintenance inside the named groups", () => {
  const summary = cloudflareLikeSummary();
  const components = [...(summary.components ?? [])].map((component) =>
    component.id === "workers" ? { ...component, status: "under_maintenance" } : component,
  );
  expect(statuspageSeverity({ ...summary, components }, CLOUDFLARE_SCOPE)).toBe("maintenance");
});

test("a scoped provider counts an incident that names an in-scope component", () => {
  const summary = cloudflareLikeSummary({
    incidents: [{ impact: "major", components: [{ id: "workers" }] }],
  });
  expect(statuspageSeverity(summary, CLOUDFLARE_SCOPE)).toBe("partial_outage");
});

test("a scoped provider ignores an incident confined to out-of-scope components", () => {
  const summary = cloudflareLikeSummary({
    incidents: [{ impact: "critical", components: [{ id: "lys" }] }],
  });
  expect(statuspageSeverity(summary, CLOUDFLARE_SCOPE)).toBe("operational");
});

test("a page-wide incident (no components named) always counts", () => {
  const summary = cloudflareLikeSummary({ incidents: [{ impact: "critical" }] });
  expect(statuspageSeverity(summary, CLOUDFLARE_SCOPE)).toBe("major_outage");
});

test("a scope that matches nothing falls back to the page indicator, never to green", () => {
  // A group renamed on their side must not silently turn every future reading operational.
  expect(statuspageSeverity(cloudflareLikeSummary(), ["Renamed Group"])).toBe("degraded");
});

test("a payload with no usable severity yields null", () => {
  expect(statuspageSeverity({}, undefined)).toBeNull();
  expect(statuspageSeverity({ components: [] }, CLOUDFLARE_SCOPE)).toBeNull();
});

test("polls a summary.json into a Provider row", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: { indicator: "minor" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(DEF, fetchImpl, NOW);
  expect(row).toMatchObject({
    id: "cloudflare",
    status: "degraded",
    reachable: true,
    fetchedAt: NOW,
    upstreamUrl: DEF.feedUrl,
  });
  expect(row.statusPageUrl).toBeUndefined();
});

test("a definition's statusPageUrl rides along on the row", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(cloudflareLikeSummary()), { status: 200 })) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(
    { ...DEF, statusPageUrl: "https://new.example/", serviceComponentGroups: CLOUDFLARE_SCOPE },
    fetchImpl,
    NOW,
  );
  expect(row).toMatchObject({ status: "operational", statusPageUrl: "https://new.example/" });
});

test("an unreachable feed yields status_unavailable, never throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(DEF, fetchImpl, NOW);
  expect(row).toMatchObject({ id: "cloudflare", status: "status_unavailable", reachable: false });
});

test("a non-ok response yields status_unavailable rather than a guess", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(DEF, fetchImpl, NOW);
  expect(row).toMatchObject({ status: "status_unavailable", reachable: false });
});

test("the Cloudflare registry entry is scoped and points readers at the current page", () => {
  const cloudflare = PROVIDER_REGISTRY.find((provider) => provider.id === "cloudflare");
  expect(cloudflare?.statusPageUrl).toBe("https://new.cloudflarestatus.com/");
  expect(cloudflare?.serviceComponentGroups).toEqual(["Cloudflare Sites and Services"]);
});
