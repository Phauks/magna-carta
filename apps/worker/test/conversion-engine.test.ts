import { describe, expect, it } from "vitest";
import { resolveEnginePort } from "../src/conversions/conversion-engine.ts";
import type { Bindings } from "../src/app.ts";

// A fake CONVERT service binding: a Fetcher whose fetch() returns a scripted Response.
function fakeConvert(response: Response): Pick<Fetcher, "fetch"> {
  return { fetch: async () => response };
}

const input = { from: "png", to: "webp", bytes: new Uint8Array([1, 2, 3]), recipeRef: "raster" };

describe("resolveEnginePort", () => {
  it("returns the deferred port (engine-not-implemented) when CONVERT is unbound", async () => {
    const port = resolveEnginePort({} as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });

  it("maps a 2xx container response to converted bytes + media type", async () => {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const convert = fakeConvert(
      new Response(out, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    const port = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(result.bytes)).toEqual(out);
      expect(result.mediaType).toBe("image/webp");
    }
  });

  it("maps a non-2xx response to adapter-error (never throws)", async () => {
    const convert = fakeConvert(new Response("bad", { status: 422 }));
    const port = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });

  it("maps a thrown transport error to adapter-error (never throws)", async () => {
    const convert: Pick<Fetcher, "fetch"> = {
      fetch: async () => {
        throw new Error("binding down");
      },
    };
    const port = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });
});
