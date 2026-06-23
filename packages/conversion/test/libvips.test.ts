import { describe, expect, it } from "vitest";
import { libvipsAdapter } from "../src/adapters/libvips/index.ts";
import { imageSize, makeImage } from "./support/vips.ts";

describe("libvips adapter", () => {
  it("converts PNG to WebP", async () => {
    const png = await makePng();
    const result = await libvipsAdapter.convert({
      bytes: png,
      from: "png",
      to: "webp",
      recipeRef: "webp",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mediaType).toBe("image/webp");
      // RIFF....WEBP magic
      expect(result.bytes[0]).toBe(0x52); // 'R'
      expect(result.bytes[8]).toBe(0x57); // 'W'
    }
  });

  it("converts JPEG to PNG and preserves dimensions", async () => {
    const jpeg = await makeJpeg();
    const result = await libvipsAdapter.convert({
      bytes: jpeg,
      from: "jpeg",
      to: "png",
      recipeRef: "png",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes[0]).toBe(0x89); // PNG magic
      expect(result.bytes[1]).toBe(0x50); // 'P'
      // Verify the dimensions are preserved: fixture is 2×3.
      const decoded = await imageSize(result.bytes);
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(3);
    }
  });

  it("returns adapter-error on corrupt input and never throws", async () => {
    const result = await libvipsAdapter.convert({
      bytes: new Uint8Array([0, 1, 2, 3, 4]),
      from: "png",
      to: "webp",
      recipeRef: "webp",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });

  it("returns unsupported-edge for a non-raster target", async () => {
    const png = await makePng();
    const result = await libvipsAdapter.convert({
      bytes: png,
      from: "png",
      to: "pdf",
      recipeRef: "pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-edge");
  });
});

// Tiny valid images (a 2×3 black image) built via the shared, memoized wasm-vips fixture.
function makePng(): Promise<Uint8Array> {
  return makeImage(".png");
}
function makeJpeg(): Promise<Uint8Array> {
  return makeImage(".jpg");
}
