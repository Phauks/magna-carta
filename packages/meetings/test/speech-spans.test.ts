import { describe, expect, it } from "vitest";
import { PCM_SAMPLE_RATE } from "../src/pcm-frame.ts";
import {
  detectSpeechSpans,
  frameLevels,
  HANGOVER_FRAMES,
  MAXIMUM_PIECE_FRAMES,
  noiseFloor,
  planSpeechPieces,
  PRE_ROLL_FRAMES,
  SPEECH_FRAME_SAMPLES,
  voicedThreshold,
} from "../src/speech-spans.ts";

// WHERE SOMEBODY IS TALKING, from synthetic audio whose answer is known: steady noise at a floor, and
// tone bursts standing well above it where "speech" is. What would be a real failure: a burst missed or
// clipped at either end, a short pause splitting one utterance in two, a click counted as speech, a
// louder room hearing its own noise as talking, a long span sent whole past the model's thirty seconds
// or cut mid-word when a pause was there to cut at, or a span open at a region's edge cut short.

const RATE = PCM_SAMPLE_RATE;
const FRAME_SECONDS = SPEECH_FRAME_SAMPLES / RATE;

/** Deterministic noise of a given peak amplitude, so a test never depends on a random draw. */
function noise(seconds: number, amplitude: number, seed = 1): Int16Array {
  const samples = new Int16Array(Math.round(seconds * RATE));
  let state = seed;
  for (let index = 0; index < samples.length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    samples[index] = Math.round(((state / 2_147_483_648) * 2 - 1) * amplitude);
  }
  return samples;
}

/** A tone burst added into `samples` over `[fromSeconds, toSeconds)`. */
function addTone(
  samples: Int16Array,
  fromSeconds: number,
  toSeconds: number,
  amplitude = 8_000,
  hertz = 440,
): void {
  const from = Math.round(fromSeconds * RATE);
  const to = Math.min(samples.length, Math.round(toSeconds * RATE));
  for (let index = from; index < to; index += 1) {
    const value =
      (samples[index] ?? 0) + amplitude * Math.sin((2 * Math.PI * hertz * index) / RATE);
    samples[index] = Math.max(-32_768, Math.min(32_767, Math.round(value)));
  }
}

/** A frame index as seconds. */
const seconds = (frame: number) => frame * FRAME_SECONDS;

describe("speech spans from a track's own energy", () => {
  it("finds each burst over a noise floor, bridges a short pause, drops a click, and keeps a hangover and pre-roll", () => {
    const track = noise(20, 100);
    addTone(track, 2, 4);
    // A 200 ms pause — shorter than the hangover — is one utterance, not two.
    addTone(track, 4.2, 6);
    addTone(track, 10, 12);
    // A 20 ms click is not a syllable.
    addTone(track, 15, 15.02, 20_000);
    const levels = frameLevels(track);
    const spans = detectSpeechSpans(levels, voicedThreshold(levels));

    expect(spans).toHaveLength(2);
    const [first, second] = spans;
    // Begins a pre-roll before the burst, ends a hangover after it — so no word is clipped.
    expect(seconds(first!.fromFrame)).toBeCloseTo(2 - PRE_ROLL_FRAMES * FRAME_SECONDS, 1);
    expect(seconds(first!.toFrame)).toBeCloseTo(6 + HANGOVER_FRAMES * FRAME_SECONDS, 1);
    expect(seconds(second!.fromFrame)).toBeCloseTo(10 - PRE_ROLL_FRAMES * FRAME_SECONDS, 1);
    expect(seconds(second!.toFrame)).toBeCloseTo(12 + HANGOVER_FRAMES * FRAME_SECONDS, 1);
    expect(spans.every((span) => !span.open)).toBe(true);
  });

  it("hears the same speech in a louder room, relative to that room's own floor", () => {
    // Noise near -40 dB: an absolute threshold that heard the quiet room would hear all of this one.
    const track = noise(12, 1_000, 7);
    addTone(track, 3, 5, 12_000);
    const levels = frameLevels(track);
    const threshold = voicedThreshold(levels);
    // The threshold sits above the room, not at a fixed level.
    expect(threshold).toBeGreaterThan(-45);
    const spans = detectSpeechSpans(levels, threshold);
    expect(spans).toHaveLength(1);
    expect(seconds(spans[0]!.fromFrame)).toBeCloseTo(3 - PRE_ROLL_FRAMES * FRAME_SECONDS, 1);
  });

  it("leaves the recorder's own silence out of the noise floor, so a muted stretch does not make room noise speech", () => {
    // A room at about -35 dB with nobody talking, and the first third of the region muted: the recorder
    // wrote zeros there. Counted, those zeros put the floor at -100 dB and the threshold at its lowest
    // bound, under the room itself.
    const track = noise(15, 600, 3);
    track.fill(0, 0, 5 * RATE);
    const levels = frameLevels(track);
    expect(noiseFloor(levels)).toBeGreaterThan(-60);
    expect(planSpeechPieces(levels, { final: true }).pieces).toEqual([]);
    // And somebody who then speaks over that room is still heard.
    addTone(track, 8, 10, 12_000);
    expect(planSpeechPieces(frameLevels(track), { final: true }).pieces).toHaveLength(1);
  });

  it("hears nothing in digital silence or in noise alone", () => {
    expect(planSpeechPieces(frameLevels(new Int16Array(5 * RATE)), { final: true }).pieces).toEqual(
      [],
    );
    expect(planSpeechPieces(frameLevels(noise(5, 300)), { final: true }).pieces).toEqual([]);
  });
});

describe("pieces the model takes", () => {
  it("cuts a long span at thirty seconds, at the quietest place in the last two when there is a pause", () => {
    const track = noise(75, 100);
    // Talking without a breath from 1 s to 71 s, except one 200 ms pause at 29.4 s.
    addTone(track, 1, 29.4);
    addTone(track, 29.6, 71);
    const levels = frameLevels(track);
    const { pieces } = planSpeechPieces(levels, { final: true });

    expect(pieces).toHaveLength(3);
    expect(pieces.every((piece) => piece.toFrame - piece.fromFrame <= MAXIMUM_PIECE_FRAMES)).toBe(
      true,
    );
    // The first cut falls inside the pause, not at the hard thirty.
    const firstCut = seconds(pieces[0]!.toFrame);
    expect(firstCut).toBeGreaterThan(29.4);
    expect(firstCut).toBeLessThanOrEqual(29.62);
    // The second has no pause within two seconds of its thirty, so it is cut at exactly thirty.
    expect(pieces[1]!.toFrame - pieces[1]!.fromFrame).toBe(MAXIMUM_PIECE_FRAMES);
    // Contiguous: nothing is lost between pieces, and nothing is sent twice.
    expect(pieces[1]!.fromFrame).toBe(pieces[0]!.toFrame);
    expect(pieces[2]!.fromFrame).toBe(pieces[1]!.toFrame);
  });

  it("holds back a span still open at a region's edge, and resumes where its last piece begins", () => {
    const track = noise(60, 100);
    addTone(track, 5, 8);
    // Still talking when the region ends at 60 s.
    addTone(track, 50, 60);
    const levels = frameLevels(track);

    const notFinal = planSpeechPieces(levels, { final: false });
    // Only the closed span is sent; the open one is left whole for the next region.
    expect(notFinal.pieces).toHaveLength(1);
    expect(seconds(notFinal.resumeFrame)).toBeCloseTo(50 - PRE_ROLL_FRAMES * FRAME_SECONDS, 1);

    // At the end of the track there is nothing more to wait for, so it is sent.
    const final = planSpeechPieces(levels, { final: true });
    expect(final.pieces).toHaveLength(2);
    expect(final.resumeFrame).toBe(levels.length);
  });

  it("resumes a pre-roll short of a region's end when nothing is open, so a word at the edge keeps its run-up", () => {
    const track = noise(60, 100);
    addTone(track, 5, 8);
    const levels = frameLevels(track);
    const plan = planSpeechPieces(levels, { final: false });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.resumeFrame).toBe(levels.length - PRE_ROLL_FRAMES);
  });

  it("never hands a region back unmoved", () => {
    // One span from the first frame to past the region's edge, shorter than a piece: treated as final
    // rather than resumed at its own start forever.
    const track = noise(10, 100);
    addTone(track, 0, 10);
    const plan = planSpeechPieces(frameLevels(track), { final: false });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.resumeFrame).toBeGreaterThan(0);
  });
});
