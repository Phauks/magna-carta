import { describe, expect, it } from "vitest";
import { forwardConvert } from "../src/forward-convert.ts";

// A minimal fake container: the real libvips image cannot run under the local test pool, and
// forwardConvert needs only a { fetch } object.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardConvert", () => {
  it("forwards POST /convert to the container and returns the bytes + content-type verbatim", async () => {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // a 'RIFF' webp-ish marker
    const container = fakeContainer(
      new Response(out, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    const request = new Request("http://convert-worker/convert", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "x-target-format": "webp", "x-source-format": "png", "x-recipe": "raster" },
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardConvert(request, container);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(out);
  });

  it("propagates a non-200 status from the container", async () => {
    const container = fakeContainer(new Response("bad input", { status: 422 }));
    const request = new Request("http://convert-worker/convert", { method: "POST", body: "x" });
    const response = await forwardConvert(request, container);
    expect(response.status).toBe(422);
  });

  it("forwards the target-format + recipe headers to the container", async () => {
    let captured: Headers | undefined;
    const container = {
      fetch: async (req: Request) => {
        captured = req.headers;
        return new Response(new Uint8Array([9]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      },
    };
    const request = new Request("http://convert-worker/convert", {
      method: "POST",
      body: "bytes",
      headers: { "x-target-format": "png", "x-recipe": "raster" },
    });
    await forwardConvert(request, container);
    expect(captured?.get("x-target-format")).toBe("png");
    expect(captured?.get("x-recipe")).toBe("raster");
  });
});
