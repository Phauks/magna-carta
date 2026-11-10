import { describe, expect, it } from "vitest";
import {
  mixPcmWindow,
  PcmMixAccumulator,
  samplesFromPcmBytes,
  writePcmBytes,
} from "../src/pcm-mix.ts";
import { PCM_SAMPLE_RATE } from "../src/pcm-frame.ts";

// THE MIXER, which is addition: tracks land at their own offsets on the recording's timeline and are
// summed, and two loud speakers at once clamp at the 16-bit limits rather than wrapping round to the
// opposite sign. What would be a real failure if it stopped holding: a track lands one sample early or
// late (every later word drifts against the others), a sum wraps (a full-scale click in a court
// record), a track that has nothing to say is anything but silence, or a window costs memory that grows
// with the recording.

function samples(...values: number[]): Int16Array {
  return Int16Array.from(values);
}

describe("mixing a window", () => {
  it("sums two aligned tracks sample by sample", () => {
    expect([
      ...mixPcmWindow(4, [
        { samples: samples(1, 2, 3, 4), offset: 0 },
        { samples: samples(10, 20, 30, 40), offset: 0 },
      ]),
    ]).toEqual([11, 22, 33, 44]);
  });

  it("lands a track at its own offset, with silence before it and after it", () => {
    expect([...mixPcmWindow(6, [{ samples: samples(5, 6), offset: 3 }])]).toEqual([
      0, 0, 0, 5, 6, 0,
    ]);
  });

  it("takes only the overlap of a track that began before the window or runs past its end", () => {
    // The caller read from inside the track: its first two samples belong to the window before.
    expect([...mixPcmWindow(3, [{ samples: samples(1, 2, 3, 4, 5, 6), offset: -2 }])]).toEqual([
      3, 4, 5,
    ]);
    // And a track that has not begun yet contributes nothing to this window.
    expect([...mixPcmWindow(3, [{ samples: samples(7, 8), offset: 3 }])]).toEqual([0, 0, 0]);
  });

  it("clamps a sum at the 16-bit limits rather than wrapping round", () => {
    const mixed = mixPcmWindow(3, [
      { samples: samples(30_000, -30_000, 32_767), offset: 0 },
      { samples: samples(30_000, -30_000, 1), offset: 0 },
      { samples: samples(0, -10, 0), offset: 0 },
    ]);
    expect([...mixed]).toEqual([32_767, -32_768, 32_767]);
  });

  it("clamps the SUM once, so a loud pair a third track pulls back is not clamped on the way", () => {
    // Pairwise clamping would give 32,767 - 20,000 = 12,767; the sum is 40,000 - 20,000.
    expect([
      ...mixPcmWindow(1, [
        { samples: samples(20_000), offset: 0 },
        { samples: samples(20_000), offset: 0 },
        { samples: samples(-20_000), offset: 0 },
      ]),
    ]).toEqual([20_000]);
  });

  it("is silence where no track reaches, and an empty track adds nothing", () => {
    expect([...mixPcmWindow(3, [])]).toEqual([0, 0, 0]);
    expect([
      ...mixPcmWindow(2, [
        { samples: samples(), offset: 0 },
        { samples: samples(4, 5), offset: 0 },
      ]),
    ]).toEqual([4, 5]);
    expect(mixPcmWindow(0, [{ samples: samples(1), offset: 0 }])).toHaveLength(0);
  });

  it("reuses storage handed to it, cleared, so many windows cost one allocation", () => {
    const sums = new Int32Array(4).fill(999);
    const into = new Int16Array(4).fill(7);
    const first = new PcmMixAccumulator(4, sums);
    first.add({ samples: samples(1, 1, 1, 1), offset: 0 });
    expect([...first.finish(into)]).toEqual([1, 1, 1, 1]);
    // A shorter last window reuses the front of the same storage, and nothing of the last one leaks.
    const second = new PcmMixAccumulator(2, sums);
    second.add({ samples: samples(3), offset: 1 });
    expect([...second.finish(into)]).toEqual([0, 3]);
  });

  it("refuses an offset or a length that is not a whole sample", () => {
    expect(() => new PcmMixAccumulator(1.5)).toThrow(RangeError);
    expect(() => new PcmMixAccumulator(2).add({ samples: samples(1), offset: 0.5 })).toThrow(
      RangeError,
    );
    expect(() => new PcmMixAccumulator(4, new Int32Array(2))).toThrow(RangeError);
  });

  it("mixes one invocation's window — ten one-minute parts of eleven tracks, bytes in and bytes out — in a third of a consumer's CPU budget", () => {
    // THE COMPOSE STEP'S WHOLE SHAPE, not only the sums: for each one-minute part, every track's span is
    // read as little-endian bytes and converted to samples, added, and let go of; the clamped mix is
    // converted back to bytes in the part. Eleven tracks is the recorder's ceiling, so this is the most
    // work one invocation can be handed, and the byte conversions on either side cost as much as the
    // sums themselves.
    const tracks = 11;
    const parts = 10;
    const partSamples = 60 * PCM_SAMPLE_RATE;
    const sums = new Int32Array(partSamples);
    const mixed = new Int16Array(partSamples);
    const partBytes = new Uint8Array(partSamples * 2);
    // One span's bytes per track, varying so nothing about the data lets the work be skipped.
    const spans = Array.from({ length: tracks }, (_unused, track) => {
      const bytes = new Uint8Array(partSamples * 2);
      const view = new DataView(bytes.buffer);
      for (let index = 0; index < partSamples; index += 1) {
        view.setInt16(index * 2, ((index * (track + 3)) % 4_001) - 2_000, true);
      }
      return bytes;
    });
    const started = performance.now();
    let checksum = 0;
    for (let part = 0; part < parts; part += 1) {
      const window = new PcmMixAccumulator(partSamples, sums);
      for (const span of spans) window.add({ samples: samplesFromPcmBytes(span), offset: 0 });
      writePcmBytes(window.finish(mixed), partBytes, 0);
      checksum += new DataView(partBytes.buffer).getInt16((partSamples - 1) * 2, true);
    }
    const seconds = (performance.now() - started) / 1000;
    let expectedLast = 0;
    for (let track = 0; track < tracks; track += 1) {
      expectedLast += (((partSamples - 1) * (track + 3)) % 4_001) - 2_000;
    }
    expectedLast = Math.max(-32_768, Math.min(32_767, expectedLast));
    expect(checksum).toBe(parts * expectedLast);
    // MEASURED AGAINST THE BUDGET IT HAS TO FIT: a queue consumer's default CPU limit is thirty
    // seconds, and this window is the whole of one invocation's mixing. A third of it leaves the
    // reads, the uploads and a slower machine their share; a regression that made the mix even a few
    // times slower than it is fails here rather than in a consumer that overruns in production.
    const CONSUMER_CPU_BUDGET_SECONDS = 30;
    expect(seconds).toBeLessThan(CONSUMER_CPU_BUDGET_SECONDS / 3);
  });
});

describe("the bytes on either side of the mix", () => {
  it("reads and writes little-endian 16-bit samples, and drops a trailing odd byte", () => {
    const bytes = Uint8Array.from([0x01, 0x00, 0xff, 0xff, 0x00, 0x80, 0x7f]);
    expect([...samplesFromPcmBytes(bytes)]).toEqual([1, -1, -32_768]);

    const written = new Uint8Array(8);
    writePcmBytes(samples(1, -1, 32_767), written, 2);
    expect([...written]).toEqual([0, 0, 0x01, 0x00, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => writePcmBytes(samples(1, 2), new Uint8Array(3), 0)).toThrow(RangeError);
  });
});
