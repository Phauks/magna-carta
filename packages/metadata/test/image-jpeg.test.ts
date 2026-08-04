import { describe, expect, it } from "vitest";
import { inspectJpegFindings, MalformedImageError, scrubJpeg } from "../src/image/jpeg.ts";

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

  it("reports data appended after the end of the image and truncates it on scrub", () => {
    // A viewer stops at EOI, so an appended file is invisible in the picture and travels with it —
    // a motion-photo video, a second document, or an archive in a polyglot file.
    const appended = [...Array.from("PK", (c) => c.charCodeAt(0)), 0x11, 0x22, 0x33];
    const carrier = new Uint8Array([...buildJpeg(), ...appended]);

    const before = inspectJpegFindings(carrier).map((f) => f.category);
    expect(before).toContain("image-trailing-data");

    const out = scrubJpeg(carrier);
    expect(inspectJpegFindings(out)).toHaveLength(0);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9); // the copy ends at the end of the image
    expect(out.length).toBeLessThan(carrier.length - appended.length + 1);
  });

  it("refuses an image whose marker structure does not parse", () => {
    // Losing sync used to yield a header-only image with an EOI stapled on: a destroyed picture
    // returned as a successful scrub.
    const desynced = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]);
    expect(() => scrubJpeg(desynced)).toThrow(MalformedImageError);
    expect(() => inspectJpegFindings(desynced)).toThrow(MalformedImageError);
  });

  it("tolerates fill bytes before a marker", () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3];
    const padded = new Uint8Array([
      0xff,
      0xd8,
      ...seg(0xe1, exif),
      0xff,
      0xff,
      0xff,
      0xda,
      0x00,
      0x03,
      0x00,
      0x11,
      0xff,
      0xd9,
    ]);
    expect(inspectJpegFindings(padded).map((f) => f.category)).toContain("image-location");
    expect(inspectJpegFindings(scrubJpeg(padded))).toHaveLength(0);
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
