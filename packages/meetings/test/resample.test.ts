import { describe, expect, it } from "vitest";
import { PCM_SAMPLE_RATE } from "../src/pcm-frame.ts";
import {
  DECIMATION_FACTOR,
  downsampleForTranscription,
  TRANSCRIPTION_SAMPLE_RATE,
} from "../src/resample.ts";

// FROM 48 kHz TO THE SPEECH MODEL'S 16 kHz. What would be a real failure: decimating without filtering
// first, so a tone above the new rate's half folds down into the speech band (a 9 kHz hiss arriving as a
// 7 kHz whistle); speech-band audio losing level on the way; or the output's length and timing
// disagreeing with the input's, which would move every line of the transcript.

/** A sine tone at the recorder's rate. */
function tone(hertz: number, seconds: number, amplitude = 10_000): Int16Array {
  return Int16Array.from(
    { length: Math.round(seconds * PCM_SAMPLE_RATE) },
    (_, index) => amplitude * Math.sin((2 * Math.PI * hertz * index) / PCM_SAMPLE_RATE),
  );
}

/** Root mean square over the middle of a signal, away from the filter's edges. */
function middleRms(samples: Int16Array): number {
  const from = Math.floor(samples.length / 4);
  const to = Math.floor((samples.length * 3) / 4);
  let squares = 0;
  for (let index = from; index < to; index += 1) squares += (samples[index] ?? 0) ** 2;
  return Math.sqrt(squares / (to - from));
}

const decibels = (ratio: number) => 20 * Math.log10(ratio);

describe("downsampling for the speech model", () => {
  it("keeps one sample in three, so a piece lasts as long at either rate", () => {
    expect(DECIMATION_FACTOR).toBe(3);
    expect(TRANSCRIPTION_SAMPLE_RATE).toBe(16_000);
    expect(downsampleForTranscription(new Int16Array(48_000)).length).toBe(16_000);
    expect(downsampleForTranscription(new Int16Array(10)).length).toBe(4);
    expect(downsampleForTranscription(new Int16Array(0)).length).toBe(0);
  });

  it("passes speech-band audio at its own level", () => {
    const input = tone(1_000, 1);
    const output = downsampleForTranscription(input);
    expect(Math.abs(decibels(middleRms(output) / middleRms(input)))).toBeLessThan(0.5);
  });

  it("attenuates a tone above 8 kHz before it can fold back into the speech band", () => {
    const input = tone(9_000, 1);
    const output = downsampleForTranscription(input);
    // Unfiltered, this would arrive at 16,000 - 9,000 = 7,000 Hz at nearly full level.
    expect(decibels(middleRms(output) / middleRms(input))).toBeLessThan(-40);
    // And the same for a tone well into the stopband.
    const high = downsampleForTranscription(tone(14_000, 1));
    expect(decibels(middleRms(high) / middleRms(tone(14_000, 1)))).toBeLessThan(-60);
  });

  it("passes a steady level through as itself", () => {
    const steady = new Int16Array(4_800).fill(1_000);
    const output = downsampleForTranscription(steady);
    // The middle is the level itself; only the first and last few samples see the silence padding.
    expect(output[800]).toBe(1_000);
  });
});
