import { describe, expect, it } from "vitest";
import { PCM_SAMPLE_RATE } from "../src/pcm-frame.ts";
import { readWavHeader, WAV_HEADER_BYTES, WAV_MAXIMUM_DATA_BYTES, wavHeader } from "../src/wav.ts";

// THE COMPOSED RECORDING'S HEADER: forty-four bytes that say what the samples are and how many of them
// follow. What would be a real failure if it stopped holding: a length that does not match the data (a
// player stops early, or reads past the end), or a format field that tells a player the wrong rate or
// width (the recording plays at the wrong speed, or as noise).

describe("the WAV header", () => {
  it("is forty-four bytes whose two lengths match the data after it", () => {
    const dataBytes = 10 * PCM_SAMPLE_RATE * 2;
    const header = wavHeader(dataBytes);
    expect(header).toHaveLength(WAV_HEADER_BYTES);
    expect(readWavHeader(header)).toEqual({
      channels: 1,
      sampleRate: 48_000,
      bitsPerSample: 16,
      // Everything after the RIFF length field: the 36 bytes of header that follow it, and the data.
      riffBytes: 36 + dataBytes,
      dataBytes,
    });
  });

  it("is written byte for byte in the canonical layout", () => {
    const header = wavHeader(4);
    const text = (from: number) => String.fromCharCode(...header.slice(from, from + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    const view = new DataView(header.buffer);
    expect(view.getUint32(4, true)).toBe(40);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint32(28, true)).toBe(96_000); // bytes per second, one channel of 16 bits
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(4);
  });

  it("describes an empty recording, and refuses a length no player could trust", () => {
    expect(readWavHeader(wavHeader(0))?.dataBytes).toBe(0);
    expect(() => wavHeader(3)).toThrow(RangeError); // half a sample
    expect(() => wavHeader(-2)).toThrow(RangeError);
    expect(() => wavHeader(WAV_MAXIMUM_DATA_BYTES + 2)).toThrow(RangeError);
  });

  it("reads back nothing from bytes that are not a header", () => {
    expect(readWavHeader(new Uint8Array(43))).toBeNull();
    const notWave = wavHeader(2);
    notWave[8] = "X".charCodeAt(0);
    expect(readWavHeader(notWave)).toBeNull();
  });
});
