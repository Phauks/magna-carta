import { describe, expect, it } from "vitest";
import { forwardScan } from "../src/forward-scan.ts";

// A minimal fake container that returns a fixed response. The real container is a Docker image that
// cannot run under the local test pool; forwardScan only needs a { fetch } object, so we pass one here.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardScan", () => {
  it("forwards POST /scan to the container and returns the response verbatim", async () => {
    const scanResult = {
      verdict: "clean",
      engineVersion: "0.103.0",
    };
    const container = fakeContainer(
      new Response(JSON.stringify(scanResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://scan-worker/scan?size=1024&contentType=application%2Fpdf", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardScan(request, container);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(scanResult);
  });

  it("propagates non-200 status codes from the container", async () => {
    const container = fakeContainer(new Response("error", { status: 500 }));
    const request = new Request("http://scan-worker/scan", {
      method: "POST",
      body: "x",
    });

    const response = await forwardScan(request, container);
    expect(response.status).toBe(500);
  });

  it("preserves the query string when forwarding to the container", async () => {
    let capturedUrl: string | undefined;
    const container = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response(JSON.stringify({ verdict: "clean", engineVersion: "0.103.0" }), {
          status: 200,
        });
      },
    };

    const request = new Request("http://scan-worker/scan?size=4096&contentType=image%2Fjpeg", {
      method: "POST",
      body: "bytes",
    });

    await forwardScan(request, container);
    expect(capturedUrl).toContain("size=4096");
    expect(capturedUrl).toContain("contentType=image%2Fjpeg");
  });
});
