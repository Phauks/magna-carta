import { describe, expect, it } from "vitest";
import { inspectJpegFindings, scrubJpeg } from "../src/image/jpeg.ts";

// Build a synthetic JPEG: SOI, APP0(JFIF), APP1(Exif), SOS + scan data, EOI.
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}
function buildJpeg(): Uint8Array {
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3]; // "Exif\0\0" + bytes
  const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    ...seg(0xe0, jfif), // APP0
    ...seg(0xe1, exif), // APP1 EXIF
    0xff,
    0xda,
    0x00,
    0x03,
    0x00, // SOS (len 3) + 1 payload byte
    0x11,
    0x22,
    0x33, // entropy data
    0xff,
    0xd9, // EOI
  ]);
}

describe("jpeg", () => {
  it("reports an image-location finding when EXIF is present", () => {
    const cats = inspectJpegFindings(buildJpeg()).map((f) => f.category);
    expect(cats).toContain("image-location");
  });

  it("strip removes the EXIF segment and preserves SOI/scan/EOI", () => {
    const out = scrubJpeg(buildJpeg());
    expect(inspectJpegFindings(out)).toHaveLength(0);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8); // SOI preserved
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9); // EOI preserved
  });

  it("strips without overflowing the stack on a large scan", () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3];
    const bigScan = Array.from({ length: 500_000 }, () => 0x55);
    const big = new Uint8Array([
      0xff,
      0xd8,
      ...seg(0xe1, exif),
      0xff,
      0xda,
      0x00,
      0x03,
      0x00,
      ...bigScan,
      0xff,
      0xd9,
    ]);
    expect(() => scrubJpeg(big)).not.toThrow();
    expect(inspectJpegFindings(scrubJpeg(big))).toHaveLength(0);
  });
});
