import { describe, expect, it } from "vitest";
import { imageEngine } from "../src/image/index.ts";
import { inspectPngFindings, scrubPng } from "../src/image/png.ts";
import { SCRUB_ALL } from "../src/options.ts";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(buf: number[]): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function chunk(type: string, data: number[]): number[] {
  const typeBytes = ascii(type);
  const len = data.length;
  const crc = crc32([...typeBytes, ...data]);
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...typeBytes,
    ...data,
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ];
}
function buildPng(): Uint8Array {
  return new Uint8Array([
    ...SIG,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk("tEXt", [...ascii("Author"), 0, ...ascii("Jane")]),
    ...chunk("IDAT", [0x78, 0x01, 0x00]),
    ...chunk("IEND", []),
  ]);
}

describe("png", () => {
  it("reports a finding for a tEXt chunk", () => {
    expect(inspectPngFindings(buildPng()).length).toBeGreaterThan(0);
  });
  it("strips tEXt and keeps IHDR/IDAT/IEND", () => {
    const out = scrubPng(buildPng());
    expect(inspectPngFindings(out)).toHaveLength(0);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toContain("IHDR");
    expect(text).toContain("IDAT");
    expect(text).toContain("IEND");
    expect(text).not.toContain("tEXt");
  });
  it("imageEngine inspect/scrub round-trips to clean", async () => {
    const engine = imageEngine("png");
    const out = await engine.scrub(buildPng(), SCRUB_ALL);
    expect((await engine.inspect(out)).clean).toBe(true);
  });
  it("strips without overflowing the stack on a large IDAT chunk", () => {
    // ~500 KB IDAT data — guards the Uint8Array.set assembly path against the spread-into-push
    // stack-overflow class that would occur if scrubPng used [...bigArray] in a push call.
    const bigData = Array.from({ length: 500_000 }, () => 0x00);
    const big = new Uint8Array([
      ...SIG,
      ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      ...chunk("tEXt", [...ascii("Author"), 0, ...ascii("Jane")]),
      ...chunk("IDAT", bigData),
      ...chunk("IEND", []),
    ]);
    expect(() => scrubPng(big)).not.toThrow();
    expect(inspectPngFindings(scrubPng(big))).toHaveLength(0);
  });
  it("reports data appended after IEND, which the scrub already drops", () => {
    const carrier = new Uint8Array([...buildPng(), ...ascii("PK"), 0x03, 0x04]);
    expect(inspectPngFindings(carrier).map((f) => f.category)).toContain("image-trailing-data");
    expect(inspectPngFindings(scrubPng(carrier))).toHaveLength(0);
  });

  it("does not hang or throw on a corrupt chunk length (high bit set)", () => {
    // A chunk whose 4-byte length field is 0x80000000 (negative if parsed signed).
    const corrupt = new Uint8Array([
      ...SIG,
      0x80,
      0x00,
      0x00,
      0x00, // length with high bit set
      0x74,
      0x45,
      0x58,
      0x74, // "tEXt"
      0x00, // (insufficient data — deliberately malformed)
    ]);
    expect(() => scrubPng(corrupt)).not.toThrow();
  });
});
