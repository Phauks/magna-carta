import { expect, test } from "vitest";
import { normalizeStatuspageIndicator, pollStatuspageProvider } from "../src/statuspage-adapter.ts";

const NOW = "2026-07-02T00:00:00.000Z";
const DEF = {
  id: "cloudflare",
  name: "Cloudflare",
  kind: "statuspage" as const,
  url: "https://x/api/v2/summary.json",
};

test("normalizes every Statuspage indicator", () => {
  expect(normalizeStatuspageIndicator("none")).toBe("operational");
  expect(normalizeStatuspageIndicator("minor")).toBe("degraded");
  expect(normalizeStatuspageIndicator("major")).toBe("partial_outage");
  expect(normalizeStatuspageIndicator("critical")).toBe("major_outage");
  expect(normalizeStatuspageIndicator("gibberish")).toBe("degraded");
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
  });
});

test("an unreachable feed yields status_unavailable, never throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const row = await pollStatuspageProvider(DEF, fetchImpl, NOW);
  expect(row).toMatchObject({ id: "cloudflare", status: "status_unavailable", reachable: false });
});
