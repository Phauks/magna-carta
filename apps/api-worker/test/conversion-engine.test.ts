import { describe, expect, it } from "vitest";
import { resolveEnginePort } from "../src/conversions/conversion-engine.ts";
import type { Bindings } from "../src/bindings.ts";

// A fake service binding: a Fetcher whose fetch() records the request it saw and returns a scripted
// Response.
function fakeBinding(response: Response): {
  fetch: Fetcher["fetch"];
  seen: () => Request | undefined;
} {
  let seen: Request | undefined;
  return {
    fetch: (async (request: Request) => {
      seen = request;
      return response;
    }) as unknown as Fetcher["fetch"],
    seen: () => seen,
  };
}

const rasterInput = {
  from: "png",
  to: "webp",
  bytes: new Uint8Array([1, 2, 3]),
  recipeRef: "webp",
};
const pdfInput = {
  from: "pdf",
  to: "searchable-pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  recipeRef: "searchable-text-layer",
};

describe("resolveEnginePort", () => {
  it("resolves every convert-worker engine to the deferred port when CONVERT is unbound", async () => {
    const resolve = resolveEnginePort({} as Bindings);
    for (const engineId of ["libvips", "image-pdf", "libreoffice", "email", "ffmpeg"] as const) {
      const result = await resolve(engineId).convert(rasterInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
    }
  });

  it("keeps an engine without a Container deferred even when CONVERT is bound", async () => {
    const convert = fakeBinding(new Response(new Uint8Array([9]), { status: 200 }));
    const resolve = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    for (const engineId of ["email", "ffmpeg"] as const) {
      const result = await resolve(engineId).convert(rasterInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
    }
    expect(convert.seen()).toBeUndefined();
  });

  it("routes the office engine to the convert worker, stamped with its engine id", async () => {
    const out = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const convert = fakeBinding(
      new Response(out, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "libreoffice",
    ).convert({ from: "docx", to: "pdf", bytes: new Uint8Array([0x50, 0x4b]), recipeRef: "pdf" });
    const headers = convert.seen()?.headers;
    expect(headers?.get("x-engine-id")).toBe("libreoffice");
    expect(headers?.get("x-source-format")).toBe("docx");
    expect(headers?.get("x-target-format")).toBe("pdf");
    expect(headers?.get("x-recipe")).toBe("pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mediaType).toBe("application/pdf");
  });

  it("routes a convert-worker engine to the CONVERT binding and maps its 2xx to bytes + media type", async () => {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const convert = fakeBinding(
      new Response(out, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "libvips",
    ).convert(rasterInput);
    expect(convert.seen()?.url).toBe("https://convert/convert");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(result.bytes)).toEqual(out);
      expect(result.mediaType).toBe("image/webp");
    }
  });

  it("sends the resolved engine id as x-engine-id so the convert worker can dispatch", async () => {
    const convert = fakeBinding(
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    const resolve = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    await resolve("image-pdf").convert({ ...rasterInput, to: "pdf", recipeRef: "image-pdf" });
    const headers = convert.seen()?.headers;
    expect(headers?.get("x-engine-id")).toBe("image-pdf");
    expect(headers?.get("x-source-format")).toBe("png");
    expect(headers?.get("x-target-format")).toBe("pdf");
    expect(headers?.get("x-recipe")).toBe("image-pdf");
  });

  it("maps a convert-worker non-2xx to adapter-error (never throws)", async () => {
    const convert = fakeBinding(new Response("bad", { status: 422 }));
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "libvips",
    ).convert(rasterInput);
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
    ).convert(rasterInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });

  it("routes the ocr engine to the OCR service's searchable endpoint and returns the PDF", async () => {
    const out = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const ocr = fakeBinding(
      new Response(out, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    const result = await resolveEnginePort({ OCR_SERVICE: ocr } as unknown as Bindings)(
      "ocr",
    ).convert(pdfInput);
    // Reaches the OCR service, not the convert worker.
    expect(ocr.seen()?.url).toBe("https://ocr/ocr/searchable");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(result.bytes)).toEqual(out);
      expect(result.mediaType).toBe("application/pdf");
    }
  });

  it("resolves the ocr engine to the deferred port when OCR_SERVICE is unbound, never falling back to CONVERT", async () => {
    const convert = fakeBinding(new Response("should not be used", { status: 200 }));
    const result = await resolveEnginePort({ CONVERT: convert } as unknown as Bindings)(
      "ocr",
    ).convert(pdfInput);
    expect(convert.seen()).toBeUndefined();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });
});
