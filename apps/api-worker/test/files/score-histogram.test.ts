// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { fetchScoreHistogram } from "../../src/files/score-histogram.ts";

// Direct unit coverage of the three branches the route handler delegates to fetchScoreHistogram for.
// SCAN_SERVICE is declared in wrangler.jsonc so the route's integration test always exercises the
// bound path (via the no-engine stub); the genuinely-unbound branch and the fault branch are only
// reachable here, by passing the binding directly.
describe("fetchScoreHistogram", () => {
  it("returns the no-engine empty shape when the scan service binding is absent", async () => {
    expect(await fetchScoreHistogram(undefined)).toEqual({
      engineVersion: null,
      minScoreGate: null,
      total: 0,
      buckets: [],
    });
  });

  it("returns the engine's histogram verbatim when the service answers", async () => {
    const histogram = {
      engineVersion: "engine/1+yara-rules/20260621+clamav-db/27268",
      minScoreGate: 75,
      total: 2,
      buckets: [{ floor: 40, count: 2 }],
    };
    const scanService = {
      fetch: async () =>
        new Response(JSON.stringify(histogram), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    } as unknown as Fetcher;
    expect(await fetchScoreHistogram(scanService)).toEqual(histogram);
  });

  it("throws when a deployed engine is unreachable — never masks a fault as an empty histogram", async () => {
    const scanService = {
      fetch: async () => new Response("upstream error", { status: 503 }),
    } as unknown as Fetcher;
    await expect(fetchScoreHistogram(scanService)).rejects.toThrow(/503/);
  });
});
