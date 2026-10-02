import { describe, expect, it } from "vitest";
import {
  decodePcmFrame,
  downmixToMono,
  MAX_PCM_FRAME_PAYLOAD_BYTES,
  monoSilenceBytes,
  monoToBytes,
  PCM_FRAME_PAYLOAD_FIELD,
  PCM_FRAME_SEQUENCE_NUMBER_FIELD,
  PCM_FRAME_TIMESTAMP_FIELD,
  sequenceGap,
} from "../src/pcm-frame.ts";

// The routing service's envelope, read by a hand-written reader rather than a protobuf runtime — so
// every branch the reader has is exercised here against envelopes built byte by byte. The reader is a
// parser of untrusted bytes, and the cases that matter most are the ones that are not a frame at all.

/** A protobuf varint, written the way the wire format writes one. */
function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

function key(field: number, wireType: number): number[] {
  return varint(field * 8 + wireType);
}

/** One envelope: a sequence number, a timestamp and a payload, in the adapter's field numbers. */
function envelope(sequenceNumber: number, timestamp: number, payload: Uint8Array): Uint8Array {
  return Uint8Array.from([
    ...key(PCM_FRAME_SEQUENCE_NUMBER_FIELD, 0),
    ...varint(sequenceNumber),
    ...key(PCM_FRAME_TIMESTAMP_FIELD, 0),
    ...varint(timestamp),
    ...key(PCM_FRAME_PAYLOAD_FIELD, 2),
    ...varint(payload.length),
    ...payload,
  ]);
}

/** Stereo little-endian PCM from sample pairs. */
function stereo(pairs: readonly (readonly [number, number])[]): Uint8Array {
  const bytes = new Uint8Array(pairs.length * 4);
  const view = new DataView(bytes.buffer);
  pairs.forEach(([left, right], index) => {
    view.setInt16(index * 4, left, true);
    view.setInt16(index * 4 + 2, right, true);
  });
  return bytes;
}

describe("decoding the adapter's envelope", () => {
  it("reads the three fields of a well-formed envelope", () => {
    const payload = stereo([
      [100, 200],
      [-300, 300],
    ]);
    const frame = decodePcmFrame(envelope(7, 960, payload));
    expect(frame).not.toBeNull();
    expect(frame?.sequenceNumber).toBe(7);
    expect(frame?.timestamp).toBe(960);
    expect([...(frame?.payload ?? [])]).toEqual([...payload]);
  });

  it("reads a multi-byte varint, which is every sequence number past 127", () => {
    const frame = decodePcmFrame(envelope(300_000, 4_000_000_000, new Uint8Array(4)));
    expect(frame?.sequenceNumber).toBe(300_000);
    expect(frame?.timestamp).toBe(4_000_000_000);
  });

  it("skips a field it does not know, of every wire type, and still reads the ones it does", () => {
    const payload = stereo([[1, 1]]);
    const bytes = Uint8Array.from([
      ...key(9, 0),
      ...varint(42),
      ...key(10, 1),
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      ...key(11, 2),
      ...varint(3),
      9,
      9,
      9,
      ...key(12, 5),
      1,
      2,
      3,
      4,
      ...envelope(5, 10, payload),
    ]);
    const frame = decodePcmFrame(bytes);
    expect(frame?.sequenceNumber).toBe(5);
    expect([...(frame?.payload ?? [])]).toEqual([...payload]);
  });

  it("answers null for a truncated message rather than reading past its end", () => {
    const whole = envelope(1, 2, stereo([[5, 5]]));
    for (let cut = 1; cut < whole.length; cut += 1) {
      const truncated = whole.subarray(0, cut);
      const frame = decodePcmFrame(truncated);
      // A cut that lands exactly between two fields is a shorter, well-formed envelope; every other
      // cut is not one, and none of them may throw or read a byte that is not there.
      if (frame !== null) expect(frame.payload.length).toBe(0);
    }
    // The length-delimited field claiming more bytes than the message holds is the case that matters.
    const lying = Uint8Array.from([...key(PCM_FRAME_PAYLOAD_FIELD, 2), ...varint(100), 1, 2, 3]);
    expect(decodePcmFrame(lying)).toBeNull();
  });

  it("answers null for a varint that never ends, and for one past a safe integer", () => {
    expect(decodePcmFrame(Uint8Array.from([0x08, 0xff, 0xff, 0xff]))).toBeNull();
    expect(
      decodePcmFrame(
        Uint8Array.from([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]),
      ),
    ).toBeNull();
  });

  it("answers null for field zero and for a group wire type, neither of which this envelope carries", () => {
    expect(decodePcmFrame(Uint8Array.from([0x00, 0x01]))).toBeNull();
    expect(decodePcmFrame(Uint8Array.from(key(3, 3)))).toBeNull();
  });

  it("takes a payload at exactly the adapter's ceiling and refuses one a byte past it", () => {
    const atCeiling = new Uint8Array(MAX_PCM_FRAME_PAYLOAD_BYTES);
    expect(decodePcmFrame(envelope(1, 1, atCeiling))?.payload.length).toBe(
      MAX_PCM_FRAME_PAYLOAD_BYTES,
    );
    expect(
      decodePcmFrame(envelope(1, 1, new Uint8Array(MAX_PCM_FRAME_PAYLOAD_BYTES + 1))),
    ).toBeNull();
  });

  it("reads an empty message as protobuf's defaults: frame zero, no payload", () => {
    expect(decodePcmFrame(new Uint8Array(0))).toEqual({
      sequenceNumber: 0,
      timestamp: 0,
      payload: new Uint8Array(0),
    });
  });
});

describe("folding two channels into one", () => {
  it("averages each pair, and the average of two extremes is still a sample", () => {
    const mono = downmixToMono(
      stereo([
        [100, 300],
        [-100, 101],
        [32767, 32767],
        [-32768, -32768],
        [32767, -32768],
      ]),
    );
    expect([...mono]).toEqual([200, 0, 32767, -32768, -1]);
  });

  it("drops a trailing partial pair rather than inventing half a moment", () => {
    const bytes = new Uint8Array([...stereo([[10, 20]]), 0x01, 0x02, 0x03]);
    expect([...downmixToMono(bytes)]).toEqual([15]);
  });

  it("reads a payload that is a view into a larger buffer at its own offset", () => {
    const whole = envelope(1, 1, stereo([[1000, 3000]]));
    const frame = decodePcmFrame(whole);
    expect(frame).not.toBeNull();
    expect([...downmixToMono(frame?.payload ?? new Uint8Array(0))]).toEqual([2000]);
  });

  it("stages mono as little-endian bytes, and silence as zeros of the right length", () => {
    expect([...monoToBytes(Int16Array.from([1, -1]))]).toEqual([0x01, 0x00, 0xff, 0xff]);
    expect(monoSilenceBytes(480).length).toBe(960);
    expect(monoSilenceBytes(480).every((byte) => byte === 0)).toBe(true);
    expect(monoSilenceBytes(-5).length).toBe(0);
  });
});

describe("counting the frames that never arrived", () => {
  it("is zero for a track's first frame and for the next one in order", () => {
    expect(sequenceGap(null, 41)).toBe(0);
    expect(sequenceGap(41, 42)).toBe(0);
  });

  it("counts a gap as the frames between the two", () => {
    expect(sequenceGap(41, 45)).toBe(3);
  });

  it("measures across the wrap of a 32-bit counter", () => {
    expect(sequenceGap(2 ** 32 - 1, 0)).toBe(0);
    expect(sequenceGap(2 ** 32 - 2, 1)).toBe(2);
  });

  it("refuses a duplicate and a frame from behind, which are already accounted for", () => {
    expect(sequenceGap(42, 42)).toBeNull();
    expect(sequenceGap(42, 40)).toBeNull();
  });
});
