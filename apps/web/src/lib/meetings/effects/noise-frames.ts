/*
 * The bookkeeping between the browser's audio blocks and the filter's frames, kept apart from the
 * worklet so it can be tested without an audio thread.
 *
 * The audio thread hands over 128 samples at a time and wants 128 back at once; the filter works on
 * 480 (10 ms at 48 kHz). Samples are gathered until a frame is full, the frame is cleaned, and the
 * cleaned samples queue for output. The queue starts with one frame of silence, which is the whole
 * delay the filter adds (10 ms), and is exactly enough that the output never runs dry: by the time
 * the first 480 samples of silence have been played, the first cleaned frame is ready.
 */

/** The name the worklet registers its processor under and the main thread asks for. */
export const NOISE_REMOVAL_PROCESSOR = "magna-carta-noise-removal";

/** Clean one frame of `frameSamples` samples from `input` into `output`. */
export type FrameCleaner = (input: Float32Array, output: Float32Array) => void;

export class FrameBridge {
  readonly #frame: Float32Array;
  readonly #cleaned: Float32Array;
  #filled = 0;
  // The output queue: a ring holding at most one frame of priming, one cleaned frame and one block.
  readonly #queue: Float32Array;
  #read = 0;
  #length: number;

  constructor(
    readonly frameSamples: number,
    readonly blockSamples: number,
  ) {
    this.#frame = new Float32Array(frameSamples);
    this.#cleaned = new Float32Array(frameSamples);
    this.#queue = new Float32Array(frameSamples * 2 + blockSamples);
    this.#length = frameSamples;
  }

  /**
   * Take one block of input, clean whatever frames it completes, and fill `output` with the next
   * block of cleaned sound. A block shorter than `blockSamples` is taken as it is; `output` is filled
   * to its own length.
   */
  push(input: Float32Array | undefined, output: Float32Array, clean: FrameCleaner): void {
    const samples = input?.length ?? output.length;
    for (let index = 0; index < samples; index += 1) {
      this.#frame[this.#filled] = input?.[index] ?? 0;
      this.#filled += 1;
      if (this.#filled === this.frameSamples) {
        clean(this.#frame, this.#cleaned);
        this.#enqueue(this.#cleaned);
        this.#filled = 0;
      }
    }
    for (let index = 0; index < output.length; index += 1) {
      if (this.#length === 0) {
        output[index] = 0;
        continue;
      }
      output[index] = this.#queue[this.#read] ?? 0;
      this.#read = (this.#read + 1) % this.#queue.length;
      this.#length -= 1;
    }
  }

  #enqueue(samples: Float32Array): void {
    const capacity = this.#queue.length;
    for (const sample of samples) {
      if (this.#length === capacity) {
        // Never reached at a steady block size; if it were, the oldest sample goes rather than the
        // delay growing without bound.
        this.#read = (this.#read + 1) % capacity;
        this.#length -= 1;
      }
      this.#queue[(this.#read + this.#length) % capacity] = sample;
      this.#length += 1;
    }
  }
}
