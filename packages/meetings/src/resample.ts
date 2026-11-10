import { PCM_SAMPLE_RATE } from "./pcm-frame.ts";

// FROM THE RECORDER'S RATE TO THE SPEECH MODEL'S: 48 kHz mono 16-bit PCM down to 16 kHz.
//
// The speech model works at 16 kHz, and sending it three times the samples it reads costs three times
// the upload for nothing. Decimating is keeping one sample in three — but keeping one in three of a
// signal that holds anything above 8 kHz (half the new rate) FOLDS that energy back down onto the band
// below it: a 9 kHz hiss becomes a 7 kHz whistle sitting on top of the speech. So the signal is
// low-passed first, and only then decimated.
//
// THE FILTER is a windowed sinc — the ideal low-pass, truncated to a finite length and tapered by a
// Blackman window so the truncation does not ring. 127 taps at 48 kHz put the transition band at about
// two kilohertz wide (5.5 x 48,000 / 127) and the stopband near 74 dB down; with the cutoff at 7 kHz,
// everything from about 8 kHz up is attenuated before it can fold, and speech — whose intelligible
// energy is below 4 kHz — passes untouched. The filter is evaluated only at the samples kept, so it
// costs 127 multiplications per OUTPUT sample: about two million a second of audio, a few tens of
// milliseconds for a thirty-second piece.
//
// The edges are padded with silence, which is what the audio either side of a speech piece is near
// enough to: a piece begins and ends at a pause, or at a cut the transcript chose because it was quiet.
//
// Pure TypeScript with no binding and no clock.

/** The rate the transcript's speech pieces are sent at: what the speech model reads. */
export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

/** How many recorder samples make one transcription sample. */
export const DECIMATION_FACTOR = PCM_SAMPLE_RATE / TRANSCRIPTION_SAMPLE_RATE;

/** The filter's length in taps: odd, so it has a centre sample and delays the signal by none. */
export const ANTI_ALIAS_TAPS = 127;

/** Where the filter's passband ends, in hertz — below the new rate's half, with room to roll off. */
export const ANTI_ALIAS_CUTOFF_HERTZ = 7_000;

/** The 16-bit limits a filtered sample is clamped to. */
const SAMPLE_MAXIMUM = 32_767;
const SAMPLE_MINIMUM = -32_768;

/**
 * The low-pass filter's coefficients, normalised so they sum to one — a steady level passes at exactly
 * the level it came in at. Computed once per isolate.
 */
function antiAliasCoefficients(): Float64Array {
  const coefficients = new Float64Array(ANTI_ALIAS_TAPS);
  const centre = (ANTI_ALIAS_TAPS - 1) / 2;
  const normalisedCutoff = ANTI_ALIAS_CUTOFF_HERTZ / PCM_SAMPLE_RATE;
  let sum = 0;
  for (let tap = 0; tap < ANTI_ALIAS_TAPS; tap += 1) {
    const distance = tap - centre;
    const sinc =
      distance === 0
        ? 2 * normalisedCutoff
        : Math.sin(2 * Math.PI * normalisedCutoff * distance) / (Math.PI * distance);
    const phase = (2 * Math.PI * tap) / (ANTI_ALIAS_TAPS - 1);
    const blackman = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    coefficients[tap] = sinc * blackman;
    sum += sinc * blackman;
  }
  for (let tap = 0; tap < ANTI_ALIAS_TAPS; tap += 1) {
    coefficients[tap] = (coefficients[tap] ?? 0) / sum;
  }
  return coefficients;
}

let coefficientsOnce: Float64Array | null = null;

/**
 * 48 kHz samples as 16 kHz samples: low-passed below the new rate's half, then one kept in three. The
 * output is `ceil(input / 3)` samples long, and output sample `n` stands for input sample `3n` — so a
 * piece's time on the recording is the same at either rate.
 */
export function downsampleForTranscription(samples: Int16Array): Int16Array {
  coefficientsOnce ??= antiAliasCoefficients();
  const coefficients = coefficientsOnce;
  const centre = (ANTI_ALIAS_TAPS - 1) / 2;
  const output = new Int16Array(Math.ceil(samples.length / DECIMATION_FACTOR));
  for (let index = 0; index < output.length; index += 1) {
    const at = index * DECIMATION_FACTOR;
    const from = Math.max(0, at - centre);
    const to = Math.min(samples.length - 1, at + centre);
    let sum = 0;
    for (let position = from; position <= to; position += 1) {
      sum += (samples[position] ?? 0) * (coefficients[position - at + centre] ?? 0);
    }
    const rounded = Math.round(sum);
    output[index] =
      rounded > SAMPLE_MAXIMUM
        ? SAMPLE_MAXIMUM
        : rounded < SAMPLE_MINIMUM
          ? SAMPLE_MINIMUM
          : rounded;
  }
  return output;
}
