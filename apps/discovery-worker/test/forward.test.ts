import { describe, expect, it } from "vitest";
import { forwardDiscovery } from "../src/forward.ts";

// A minimal fake container: the real discovery engine image cannot run under the local test pool, and
// forwardDiscovery needs only a { fetch } object.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardDiscovery", () => {
  it("targets the operation path at the container and returns the JSON body verbatim", async () => {
    let capturedUrl: string | undefined;
    const container = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response(JSON.stringify({ format: "pdf", confidence: "certain" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    };
    const request = new Request("http://discovery-worker/identify", {
      method: "POST",
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardDiscovery(request, "/identify", container);
    expect(capturedUrl).toBe("http://discovery/identify");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ format: "pdf", confidence: "certain" });
  });

  it("propagates the engine's 422 and its stable code unchanged", async () => {
    // The 422 is how a named exception reaches the loader — a document that read to no text, an
    // encrypted package, a guard that tripped. Collapsing it into a 500 here would turn every one of
    // those into "the engine broke", which is the opposite of an honest exception report.
    const container = fakeContainer(
      new Response(JSON.stringify({ code: "noTextExtracted" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = new Request("http://discovery-worker/read", { method: "POST", body: "x" });
    const response = await forwardDiscovery(request, "/read", container);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "noTextExtracted" });
  });

  it("forwards each operation path unchanged to the container host", async () => {
    for (const operation of [
      "/identify",
      "/read",
      "/digest",
      "/archive/enumerate",
      "/archive/expand",
    ]) {
      let capturedUrl: string | undefined;
      const container = {
        fetch: async (req: Request) => {
          capturedUrl = req.url;
          return new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      };
      const request = new Request(`http://discovery-worker${operation}`, {
        method: "POST",
        body: "x",
      });
      await forwardDiscovery(request, operation, container);
      expect(capturedUrl).toBe(`http://discovery${operation}`);
    }
  });

  it("streams the body through rather than buffering it", async () => {
    // A production document can be hundreds of megabytes. The proxy passes the request's own body
    // stream to the container, so the Worker never holds the document — the property that makes
    // forwarding a large file possible at all inside a Worker's memory budget.
    let forwardedBody: BodyInit | null | undefined;
    const container = {
      fetch: async (req: Request) => {
        forwardedBody = req.body;
        return new Response("{}", { status: 200 });
      },
    };
    const request = new Request("http://discovery-worker/read", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await forwardDiscovery(request, "/read", container);
    expect(forwardedBody).toBeInstanceOf(ReadableStream);
  });
});
