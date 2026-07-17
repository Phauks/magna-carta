import { describe, expect, it } from "vitest";
import { resolveEnginePort } from "../src/conversions/conversion-engine.ts";
import type { Bindings } from "../src/app.ts";

// A fake CONVERT service binding: a Fetcher whose fetch() returns a scripted Response.
function fakeConvert(response: Response): Pick<Fetcher, "fetch"> {
  return { fetch: async () => response };
}

const input = { from: "png", to: "webp", bytes: new Uint8Array([1, 2, 3]), recipeRef: "raster" };

describe("resolveEnginePort", () => {
  it("resolves every engine to the deferred port (engine-not-implemented) when CONVERT is unbound", async () => {
    const resolve = resolveEnginePort({} as Bindings);
    for (const engineId of ["libvips", "image-pdf", "libreoffice", "email", "ffmpeg"] as const) {
      const result = await resolve(engineId).convert(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
    }
  });

  it("keeps an engine without a Container deferred even when CONVERT is bound", async () => {
    const convert = fakeConvert(new Response(new Uint8Array([9]), { status: 200 }));
    const resolve = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    for (const engineId of ["libreoffice", "email", "ffmpeg"] as const) {
      const result = await resolve(engineId).convert(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
    }
  });

  it("maps a 2xx container response to converted bytes + media type", async () => {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const convert = fakeConvert(
      new Response(out, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "libvips",
    ).convert(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(result.bytes)).toEqual(out);
      expect(result.mediaType).toBe("image/webp");
    }
  });

  it("sends the resolved engine id as x-engine-id so the convert worker can dispatch", async () => {
    let captured: Headers | undefined;
    const convert: Pick<Fetcher, "fetch"> = {
      fetch: async (request) => {
        captured = new Request(request as RequestInfo).headers;
        return new Response(new Uint8Array([9]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      },
    };
    const resolve = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    await resolve("image-pdf").convert({ ...input, to: "pdf", recipeRef: "image-pdf" });
    expect(captured?.get("x-engine-id")).toBe("image-pdf");
    expect(captured?.get("x-source-format")).toBe("png");
    expect(captured?.get("x-target-format")).toBe("pdf");
    expect(captured?.get("x-recipe")).toBe("image-pdf");
  });

  it("maps a non-2xx response to adapter-error (never throws)", async () => {
    const convert = fakeConvert(new Response("bad", { status: 422 }));
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "libvips",
    ).convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });

  it("maps a thrown transport error to adapter-error (never throws)", async () => {
    const convert: Pick<Fetcher, "fetch"> = {
      fetch: async () => {
        throw new Error("binding down");
      },
    };
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "libvips",
    ).convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });
});
