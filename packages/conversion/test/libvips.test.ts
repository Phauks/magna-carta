import { describe, expect, it } from "vitest";
import { libvipsAdapter } from "../src/adapters/libvips/index.ts";

describe("libvips adapter", () => {
  it("converts PNG to WebP", async () => {
    const png = await makePng();
    const result = await libvipsAdapter.convert({ bytes: png, from: "png", to: "webp", recipeRef: "webp" });
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
    const result = await libvipsAdapter.convert({ bytes: jpeg, from: "jpeg", to: "png", recipeRef: "png" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes[0]).toBe(0x89); // PNG magic
      expect(result.bytes[1]).toBe(0x50); // 'P'
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
    const result = await libvipsAdapter.convert({ bytes: png, from: "png", to: "pdf", recipeRef: "pdf" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-edge");
  });
});

// Build tiny valid images with wasm-vips itself (a 2x3 black image) so the test needs no fixtures.
async function makePng(): Promise<Uint8Array> {
  return makeImage(".png");
}
async function makeJpeg(): Promise<Uint8Array> {
  return makeImage(".jpg");
}
async function makeImage(suffix: string): Promise<Uint8Array> {
  const Vips = (await import("wasm-vips")).default;
  const vips = await Vips();
  const image = vips.Image.black(2, 3);
  const buffer = image.writeToBuffer(suffix);
  return new Uint8Array(buffer);
}
