import { describe, expect, it } from "vitest";
import { forwardRecovery } from "../src/forward.ts";

// A minimal fake container: the real recovery engine image cannot run under the local test pool, and
// forwardRecovery needs only a { fetch } object.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardRecovery", () => {
  it("targets the operation path at the container and returns the JSON body verbatim", async () => {
    let capturedUrl: string | undefined;
    const container = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response(JSON.stringify({ recoverability: "repairable" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    };
    const request = new Request("http://recovery-worker/diagnose", {
      method: "POST",
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardRecovery(request, "/diagnose", container);
    expect(capturedUrl).toBe("http://recovery/diagnose");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recoverability: "repairable" });
  });

  it("propagates a non-200 status (e.g. 422 unrepairable) from the container", async () => {
    const container = fakeContainer(
      new Response(JSON.stringify({ code: "unrepairable" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = new Request("http://recovery-worker/repair", { method: "POST", body: "x" });
    const response = await forwardRecovery(request, "/repair", container);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "unrepairable" });
  });

  it("forwards each operation path unchanged to the container host", async () => {
    for (const op of ["/diagnose", "/repair", "/carve"]) {
      let capturedUrl: string | undefined;
      const container = {
        fetch: async (req: Request) => {
          capturedUrl = req.url;
          return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        },
      };
      const request = new Request(`http://recovery-worker${op}`, { method: "POST", body: "bytes" });
      await forwardRecovery(request, op, container);
      expect(capturedUrl).toBe(`http://recovery${op}`);
    }
  });
});
