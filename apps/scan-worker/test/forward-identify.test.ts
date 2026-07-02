import { describe, expect, it } from "vitest";
import { forwardIdentify } from "../src/forward-identify.ts";

function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardIdentify", () => {
  it("forwards POST /identify to the container and returns the response verbatim", async () => {
    const rawIdentify = {
      label: "pdf",
      score: 0.99,
      group: "document",
      magikaVersion: "1.0.0",
      modelVersion: "standard_v3",
    };
    const container = fakeContainer(
      new Response(JSON.stringify(rawIdentify), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = new Request("http://scan-worker/identify?size=1024", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardIdentify(request, container);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rawIdentify);
  });

  it("targets the container's /identify path", async () => {
    let capturedUrl: string | undefined;
    const container = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response("{}", { status: 200 });
      },
    };
    await forwardIdentify(
      new Request("http://scan-worker/identify?size=9", { method: "POST", body: "x" }),
      container,
    );
    expect(capturedUrl).toBe("http://scan/identify?size=9");
  });
});
