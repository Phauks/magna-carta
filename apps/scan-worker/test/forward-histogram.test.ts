import { describe, expect, it } from "vitest";
import { forwardHistogram } from "../src/forward-histogram.ts";

describe("forwardHistogram", () => {
  it("forwards GET /rules/score-histogram to the container and returns its response verbatim", async () => {
    let seenPath: string | undefined;
    let seenMethod: string | undefined;
    const histogram = { engineVersion: "e", minScoreGate: 75, total: 0, buckets: [] };
    const container = {
      fetch: async (request: Request) => {
        seenPath = new URL(request.url).pathname;
        seenMethod = request.method;
        return new Response(JSON.stringify(histogram), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };

    const response = await forwardHistogram(container);
    expect(seenPath).toBe("/rules/score-histogram");
    expect(seenMethod).toBe("GET");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(histogram);
  });

  it("propagates a non-200 status from the container", async () => {
    const container = { fetch: async () => new Response("error", { status: 503 }) };
    const response = await forwardHistogram(container);
    expect(response.status).toBe(503);
  });
});
