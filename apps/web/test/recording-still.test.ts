import { describe, expect, it } from "vitest";
import {
  momentLabel,
  pngWithText,
  stillTextEntries,
} from "../src/lib/documents/recording-still.ts";

// The smallest valid PNG: a 1x1 picture. Signature, IHDR, IDAT, IEND.
const ONE_PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

function chunksOf(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

describe("a still's provenance", () => {
  it("writes the moment as a reader does", () => {
    expect(momentLabel(0)).toBe("0:00:00");
    expect(momentLabel(761.9)).toBe("0:12:41");
    expect(momentLabel(3 * 3600 + 5)).toBe("3:00:05");
  });

  it("names the recording, its version, the moment, the matter and who took it", () => {
    const entries = new Map(
      stillTextEntries({
        recordingName: "Deposition of J. Smith.mp4",
        versionNumber: 2,
        seconds: 761,
        matterTitle: "Smith v Jones",
        takenBy: "Trevor",
        takenAt: "2026-11-13T21:00:00.000Z",
      }),
    );
    expect(entries.get("Title")).toBe("Deposition of J. Smith.mp4 at 0:12:41");
    expect(entries.get("Description")).toBe(
      "A still taken at 0:12:41 from Deposition of J. Smith.mp4, version 2, in the matter Smith v Jones.",
    );
    expect(entries.get("Source")).toBe("Deposition of J. Smith.mp4, version 2");
    expect(entries.get("Author")).toBe("Trevor");
    expect(entries.get("Creation Time")).toBe("2026-11-13T21:00:00.000Z");
  });

  it("leaves out what it does not know rather than guessing", () => {
    const entries = new Map(
      stillTextEntries({
        recordingName: "clip.mov",
        versionNumber: 1,
        seconds: 5,
        matterTitle: null,
        takenBy: null,
        takenAt: "2026-11-13T21:00:00.000Z",
      }),
    );
    expect(entries.has("Author")).toBe(false);
    expect(entries.get("Description")).toBe("A still taken at 0:00:05 from clip.mov, version 1.");
  });
});

describe("pngWithText", () => {
  it("writes each entry as a UTF-8 iTXt chunk just before IEND, keeping every chunk valid", () => {
    const out = pngWithText(ONE_PIXEL, [
      ["Title", "Entrevista á 0:00:05"],
      ["Author", "Trevor"],
    ]);
    const chunks = chunksOf(out);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "iTXt", "iTXt", "IEND"]);
    const title = chunks[2]?.data ?? new Uint8Array();
    const nul = title.indexOf(0);
    expect(new TextDecoder().decode(title.subarray(0, nul))).toBe("Title");
    expect(new TextDecoder().decode(title.subarray(nul + 5))).toBe("Entrevista á 0:00:05");
    // The original chunks are untouched.
    expect(out.subarray(0, ONE_PIXEL.length - 12)).toEqual(
      ONE_PIXEL.subarray(0, ONE_PIXEL.length - 12),
    );
  });

  it("computes the chunk checksum the PNG specification defines", () => {
    // The CRC of an iTXt chunk is over its type and data; recompute it independently here.
    const out = pngWithText(ONE_PIXEL, [["Title", "x"]]);
    const chunk = chunksOf(out)[2];
    if (chunk === undefined) throw new Error("no chunk");
    const start = out.indexOf(0x69, ONE_PIXEL.length - 12); // the "i" of iTXt
    const typeAndData = out.subarray(start, start + 4 + chunk.data.length);
    let crc = 0xffffffff;
    for (const byte of typeAndData) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const expected = (crc ^ 0xffffffff) >>> 0;
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(start + 4 + chunk.data.length)).toBe(expected);
  });

  it("hands back bytes that are not a PNG unchanged", () => {
    const notPng = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(pngWithText(notPng, [["Title", "x"]])).toBe(notPng);
  });
});
