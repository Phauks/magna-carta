import { describe, expect, it } from "vitest";
import {
  decodePcmFrame,
  downmixToMono,
  MAX_PCM_FRAME_PAYLOAD_BYTES,
  PCM_FRAME_PAYLOAD_FIELD,
  PCM_FRAME_SEQUENCE_NUMBER_FIELD,
  PCM_FRAME_TIMESTAMP_FIELD,
  PcmPartStager,
  SEQUENCE_REORDER_WINDOW_FRAMES,
  sequenceGap,
  sequenceStep,
  type StagedPart,
} from "../src/pcm-frame.ts";
import {
  RECORDED_TRACK_CEILING_MAXIMUM,
  RECORDER_ISOLATE_MEMORY_BYTES,
  RECORDER_RESERVED_BYTES,
  RECORDER_WORST_CASE_STAGING_BYTES,
  RECORDING_PART_BYTES,
  RECORDING_TRACK_BUFFER_BYTES,
  recordedTrackCeilingDefinition,
} from "../src/settings.ts";

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

describe("reading a sequence number against the last one taken", () => {
  it("is the first frame, or the next one after however many never arrived", () => {
    expect(sequenceStep(null, 7)).toEqual({ kind: "first" });
    expect(sequenceStep(7, 8)).toEqual({ kind: "ahead", missing: 0 });
    expect(sequenceStep(7, 11)).toEqual({ kind: "ahead", missing: 3 });
    expect(sequenceStep(2 ** 32 - 1, 0)).toEqual({ kind: "ahead", missing: 0 });
  });

  it("discards a repeat and a frame a little behind, inside the reorder window", () => {
    expect(sequenceStep(500, 500)).toEqual({ kind: "behind" });
    expect(sequenceStep(500, 499)).toEqual({ kind: "behind" });
    expect(sequenceStep(500, 500 - SEQUENCE_REORDER_WINDOW_FRAMES)).toEqual({ kind: "behind" });
  });

  it("reads a jump backwards past the window as a counter that started again", () => {
    // Before this, a counter that restarted at zero was treated as already accounted for, and every
    // frame was discarded until the new counter climbed past the old one.
    expect(sequenceStep(500, 500 - SEQUENCE_REORDER_WINDOW_FRAMES - 1)).toEqual({ kind: "reset" });
    expect(sequenceStep(90_000, 0)).toEqual({ kind: "reset" });
  });
});

/** Mono samples all of one value. */
function monoOf(count: number, value: number): Int16Array {
  return new Int16Array(count).fill(value);
}

/** Uploads every part the stager has due, as a recorder would, and answers what went up. */
function drain(stager: PcmPartStager): StagedPart[] {
  const parts: StagedPart[] = [];
  for (let part = stager.nextPart(); part !== null; part = stager.nextPart()) {
    parts.push(part.kind === "buffer" ? { kind: "buffer", bytes: part.bytes.slice() } : part);
    stager.partUploaded();
  }
  return parts;
}

describe("staging one track in one fixed buffer", () => {
  const part = 64;
  const overflow = 16;

  it("hands out a part as a view of its own buffer once it is full, and moves the overflow down in place", () => {
    const buffer = new Uint8Array(part + overflow);
    const stager = new PcmPartStager(buffer, part);
    expect(stager.writeAudio(monoOf(30, 7))).toBe(true);
    expect(stager.nextPart()).toBeNull();
    expect(stager.writeAudio(monoOf(3, 9))).toBe(true);
    const due = stager.nextPart();
    expect(due?.kind).toBe("buffer");
    // A view of the buffer it was given, never a copy.
    expect(due?.kind === "buffer" && due.bytes.buffer).toBe(buffer.buffer);
    expect(due?.kind === "buffer" && due.bytes.byteLength).toBe(part);
    // One part out at a time.
    expect(stager.nextPart()).toBeNull();
    stager.partUploaded();
    expect(stager.heldBytes).toBe(33 * 2 - part);
    expect(new DataView(buffer.buffer).getInt16(0, true)).toBe(9);
  });

  it("drops a frame that does not fit while a part is out, and keeps its length as silence", () => {
    const stager = new PcmPartStager(new Uint8Array(part + overflow), part);
    stager.writeAudio(monoOf(32, 1));
    expect(stager.nextPart()?.kind).toBe("buffer");
    expect(stager.writeAudio(monoOf(8, 2))).toBe(true);
    // The overflow is full: this frame is dropped, and becomes silence on the timeline.
    expect(stager.writeAudio(monoOf(4, 3))).toBe(false);
    expect(stager.pendingSilenceBytes).toBe(8);
    expect(stager.heldBytes).toBe(part + overflow);
    stager.partUploaded();
    // Once there is room, the next frame lands after the silence, at its own instant.
    expect(stager.writeAudio(monoOf(4, 5))).toBe(true);
    expect(stager.heldBytes).toBe(overflow + 8 + 8);
  });

  it("never allocates for a long gap: whole parts of silence are counted, not written", () => {
    // Five minutes of silence at 48 kHz is 28.8 MB; with real part sizes it would have been allocated
    // whole. Here the gap is 1,000 parts long and the stager holds exactly the buffer it was given —
    // and the audio after the gap is taken at once, not dropped while the gap drains.
    const buffer = new Uint8Array(part + 2 * overflow);
    const stager = new PcmPartStager(buffer, part);
    stager.writeAudio(monoOf(10, 4));
    const gapSamples = (1000 * part) / 2 + 6;
    stager.writeSilence(gapSamples);
    expect(stager.writeAudio(monoOf(10, 8))).toBe(true);
    expect(stager.capacityBytes).toBe(part + 2 * overflow);
    expect(stager.silencePartsQueued).toBe(999);

    const parts = drain(stager);
    const last = stager.finalPart();
    const total =
      parts.reduce((sum, one) => sum + (one.kind === "buffer" ? one.bytes.byteLength : part), 0) +
      (last?.byteLength ?? 0);
    expect(total).toBe(20 + gapSamples * 2 + 20);
    expect(parts.filter((one) => one.kind === "silence")).toHaveLength(999);
    // The first part is the audio and the start of the gap; the audio after the gap lands last.
    const first = parts[0];
    expect(first?.kind === "buffer" && new DataView(first.bytes.buffer).getInt16(0, true)).toBe(4);
    expect(first?.kind === "buffer" && first.bytes.subarray(20).every((byte) => byte === 0)).toBe(
      true,
    );
    expect(
      last !== null &&
        new DataView(last.buffer, last.byteOffset).getInt16(last.byteLength - 2, true),
    ).toBe(8);
  });

  it("keeps counted silence in order behind a part that is full and out", () => {
    const stager = new PcmPartStager(new Uint8Array(part + overflow), part);
    stager.writeAudio(monoOf(32, 1));
    expect(stager.nextPart()?.kind).toBe("buffer");
    // One whole part of silence and two samples more, behind a full part that is uploading.
    stager.writeSilence(part / 2 + 2);
    expect(stager.writeAudio(monoOf(2, 6))).toBe(true);
    stager.partUploaded();
    const parts = drain(stager);
    expect(parts.map((one) => one.kind)).toEqual(["silence"]);
    const last = stager.finalPart();
    expect(last?.byteLength).toBe(8);
    expect(last !== null && new DataView(last.buffer, last.byteOffset).getInt16(0, true)).toBe(0);
    expect(last !== null && new DataView(last.buffer, last.byteOffset).getInt16(4, true)).toBe(6);
  });

  it("gives up a part that could not upload as a part of silence, keeping the timeline's length", () => {
    const stager = new PcmPartStager(new Uint8Array(part + overflow), part);
    stager.writeAudio(monoOf(34, 3));
    expect(stager.nextPart()?.kind).toBe("buffer");
    stager.partFailed();
    // Failed, it is handed out again unchanged.
    expect(stager.nextPart()?.kind).toBe("buffer");
    stager.partFailed();
    expect(stager.replaceHeadWithSilence()).toBe(part / 2);
    expect(stager.nextPart()?.kind).toBe("silence");
    stager.partUploaded();
    expect(stager.heldBytes).toBe(4);
  });

  it("pads the part being written to a boundary for a track that stops for now", () => {
    const stager = new PcmPartStager(new Uint8Array(part + overflow), part);
    stager.writeAudio(monoOf(5, 2));
    expect(stager.padToPartBoundary()).toBe((part - 10) / 2);
    const parts = drain(stager);
    expect(parts).toHaveLength(1);
    expect(stager.heldBytes).toBe(0);
    expect(stager.finalPart()).toBeNull();
  });
});

describe("the memory arithmetic a recorder is bounded by", () => {
  it("fits a recorder at its ceiling inside the isolate with the reserve untouched", () => {
    expect(RECORDING_PART_BYTES).toBe(5 * 1024 * 1024);
    expect(RECORDED_TRACK_CEILING_MAXIMUM).toBeGreaterThanOrEqual(1);
    expect(RECORDER_WORST_CASE_STAGING_BYTES + RECORDER_RESERVED_BYTES).toBeLessThanOrEqual(
      RECORDER_ISOLATE_MEMORY_BYTES,
    );
    // One track more would not fit.
    expect(
      RECORDER_WORST_CASE_STAGING_BYTES + RECORDING_TRACK_BUFFER_BYTES + RECORDER_RESERVED_BYTES,
    ).toBeGreaterThan(RECORDER_ISOLATE_MEMORY_BYTES);
  });

  it("refuses a firm setting past the ceiling the memory allows", () => {
    expect(recordedTrackCeilingDefinition.defaultValue).toBe(RECORDED_TRACK_CEILING_MAXIMUM);
    expect(
      recordedTrackCeilingDefinition.schema.safeParse(RECORDED_TRACK_CEILING_MAXIMUM + 1).success,
    ).toBe(false);
  });
});
