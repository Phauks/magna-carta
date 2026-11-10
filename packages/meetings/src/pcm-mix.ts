// THE MIXER: several mono tracks of one recording, each starting at its own place on the recording's
// timeline, summed into one mono window — the arithmetic the compose step does to make one document
// out of a recording's staged tracks.
//
// It is ADDITION, not signal processing. Every track is 16-bit signed PCM at the recorder's one sample
// rate, already folded to mono and already on the recording's timeline (the recorder wrote silence for
// every frame that never arrived), so lining them up is an offset and mixing them is a sum. The sum is
// taken in 32 bits and clamped once at the end, so two loud speakers at once SATURATE at the 16-bit
// limits rather than wrapping round to the opposite sign — a wrap is a click as loud as the format
// allows, and a clamp is the loudness it already had.
//
// Pure TypeScript with no binding and no clock. The compose consumer in the Worker is the only caller,
// and it hands this module one bounded window at a time, so nothing here ever holds a whole recording.

/** The 16-bit limits a sum is clamped to. */
const SAMPLE_MAXIMUM = 32_767;
const SAMPLE_MINIMUM = -32_768;

/** One track's samples for a window, and where in the window its first sample lands. */
export interface PcmMixInput {
  readonly samples: Int16Array;
  // The window sample the track's FIRST sample lands on. Negative when the track began before the
  // window did — the caller read from inside the track — and past the window's end when it has not
  // begun yet; either way only what overlaps the window is summed.
  readonly offset: number;
}

/**
 * A WINDOW BEING MIXED, one track at a time. The compose consumer reads one track's span for the window,
 * adds it, and lets go of it before reading the next — so what a window costs in memory is the
 * accumulator and one track's span, however many tracks the recording held.
 */
export class PcmMixAccumulator {
  readonly length: number;
  private readonly sums: Int32Array;

  /**
   * @param length the window's length in samples.
   * @param storage optional storage for the sums, at least `length` long, so a caller mixing many
   *   windows of one size allocates it once; it is cleared before use.
   */
  constructor(length: number, storage?: Int32Array) {
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`a mix window is a whole number of samples, not ${String(length)}`);
    }
    if (storage !== undefined && storage.length < length) {
      throw new RangeError("the storage handed to a mix window is shorter than the window");
    }
    this.length = length;
    this.sums = storage === undefined ? new Int32Array(length) : storage.subarray(0, length);
    this.sums.fill(0);
  }

  /**
   * Adds one track's samples at their offset. What falls outside the window is ignored — the part of a
   * track before the window, or past its end — and an empty track adds nothing, which is exactly the
   * silence a track with nothing to say contributes.
   */
  add(input: PcmMixInput): void {
    if (!Number.isInteger(input.offset)) {
      throw new RangeError(`a track lands on a whole sample, not ${String(input.offset)}`);
    }
    const from = Math.max(0, input.offset);
    const to = Math.min(this.length, input.offset + input.samples.length);
    for (let position = from; position < to; position += 1) {
      this.sums[position] =
        (this.sums[position] ?? 0) + (input.samples[position - input.offset] ?? 0);
    }
  }

  /**
   * The mixed window, clamped once to 16 bits. Written into `into` when given (at least `length` long,
   * so a caller writing many windows of one size allocates it once), and returned.
   */
  finish(into?: Int16Array): Int16Array {
    if (into !== undefined && into.length < this.length) {
      throw new RangeError("the window handed to receive a mix is shorter than the mix");
    }
    const mixed = into === undefined ? new Int16Array(this.length) : into.subarray(0, this.length);
    for (let position = 0; position < this.length; position += 1) {
      const sum = this.sums[position] ?? 0;
      mixed[position] =
        sum > SAMPLE_MAXIMUM ? SAMPLE_MAXIMUM : sum < SAMPLE_MINIMUM ? SAMPLE_MINIMUM : sum;
    }
    return mixed;
  }
}

/**
 * N tracks summed with saturation into one mono window of `length` samples, each landing at its own
 * offset. A window no track reaches is silence.
 */
export function mixPcmWindow(length: number, inputs: readonly PcmMixInput[]): Int16Array {
  const accumulator = new PcmMixAccumulator(length);
  for (const input of inputs) accumulator.add(input);
  return accumulator.finish();
}

/**
 * Little-endian 16-bit PCM bytes as samples. A trailing odd byte is not half a sample anybody wrote, so
 * it is dropped rather than guessed at.
 */
export function samplesFromPcmBytes(bytes: Uint8Array): Int16Array {
  const count = Math.floor(bytes.byteLength / 2);
  const samples = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let index = 0; index < count; index += 1) samples[index] = view.getInt16(index * 2, true);
  return samples;
}

/** Samples as little-endian 16-bit PCM bytes, written into `into` at `byteOffset`. */
export function writePcmBytes(samples: Int16Array, into: Uint8Array, byteOffset: number): void {
  if (byteOffset < 0 || byteOffset + samples.length * 2 > into.byteLength) {
    throw new RangeError("the samples do not fit where they were asked to be written");
  }
  const view = new DataView(into.buffer, into.byteOffset + byteOffset, samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index] ?? 0, true);
  }
}
