import { expect, test } from "vitest";
import { deriveComponents } from "../src/derive.ts";

const NOW = "2026-07-02T00:00:00.000Z";
const base = { now: NOW, probes: {}, signals: {}, degradedThreshold: 0.1, outageThreshold: 1 };

function byId(components: ReturnType<typeof deriveComponents>, id: string) {
  return components.find((c) => c.id === id);
}

test("an idle engine defaults to operational (never unknown)", () => {
  const out = deriveComponents(base);
  const collabora = byId(out, "collabora");
  expect(collabora?.status).toBe("operational");
  expect(collabora?.source).toBe("telemetry");
});

test("a failed core probe flips that component to major_outage", () => {
  const out = deriveComponents({ ...base, probes: { "control-plane-database": { ok: false } } });
  expect(byId(out, "control-plane-database")?.status).toBe("major_outage");
  // A passing probe elsewhere stays operational.
  const out2 = deriveComponents({ ...base, probes: { "control-plane-database": { ok: true } } });
  expect(byId(out2, "control-plane-database")?.status).toBe("operational");
});

test("engine telemetry error signal degrades then outages by threshold", () => {
  const degraded = deriveComponents({
    ...base,
    signals: { collabora: { errorRatePerMinute: 0.5, sampleCount: 20 } },
  });
  expect(byId(degraded, "collabora")?.status).toBe("degraded");
  const outage = deriveComponents({
    ...base,
    signals: { collabora: { errorRatePerMinute: 5, sampleCount: 20 } },
  });
  expect(byId(outage, "collabora")?.status).toBe("partial_outage");
});
