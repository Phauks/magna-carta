// Person segmentation for a meeting's camera: which pixels of a small frame are the member and which
// are the room behind them. The background blur and image backgrounds composite from this mask.
//
// The engine is Rust (crates/segmentation-core, over the rten runtime) compiled to WebAssembly with
// the model built in, so loading it is one fetch. It is meant to run in a Web Worker: a frame takes
// roughly 14 ms, which the meeting's main thread cannot spare thirty times a second.
//
// The model sees only FRAME_WIDTH x FRAME_HEIGHT. The caller scales the camera frame down to that,
// segments it, and scales the mask back up when compositing; the network never sees any of this.
import init, { frameHeight, frameWidth, Segmenter } from "./pkg/segmentation_core.js";

let ready: Promise<unknown> | undefined;

/**
 * Load the WebAssembly module once. In a browser Worker, call it with nothing and the module fetches
 * its own .wasm beside it; under Node (tests) pass the bytes; a bundler may pass a compiled Module.
 */
export async function ensureReady(
  wasmInput?: Uint8Array | ArrayBuffer | WebAssembly.Module,
): Promise<void> {
  if (ready === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready = wasmInput !== undefined ? init({ module_or_path: wasmInput as any }) : init();
  }
  await ready;
}

/** The fixed codes a segmentation can fail with. Nothing in one carries frame content. */
export const SEGMENTATION_ERROR_CODES = [
  "modelUnavailable",
  "frameSize",
  "inferenceFailed",
] as const;
export type SegmentationErrorCode = (typeof SEGMENTATION_ERROR_CODES)[number];

export class SegmentationError extends Error {
  constructor(readonly code: SegmentationErrorCode) {
    super(code);
    this.name = "SegmentationError";
  }
}

function asSegmentationError(error: unknown): SegmentationError {
  const message = error instanceof Error ? error.message : String(error);
  const code = SEGMENTATION_ERROR_CODES.find((candidate) => candidate === message);
  return new SegmentationError(code ?? "inferenceFailed");
}

/** The model's input size, read from the engine so nothing here can drift from it. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/** A loaded segmenter. Make one when a member turns an effect on; reuse it for every frame. */
export interface PersonSegmenter {
  readonly frame: FrameSize;
  /**
   * Segment one frame: `frame.height` rows of `frame.width` pixels, red, green and blue in 0-1,
   * row-major. Answers one value per pixel in 0-1, where 1 is the person.
   */
  segment(rgb: Float32Array): Float32Array;
  /** Release the engine's memory. The segmenter is unusable afterwards. */
  release(): void;
}

/** Load the model and answer a segmenter. `ensureReady` must have resolved first. */
export function loadPersonSegmenter(): PersonSegmenter {
  let engine: Segmenter;
  try {
    engine = new Segmenter();
  } catch (error) {
    throw asSegmentationError(error);
  }
  const frame: FrameSize = { width: frameWidth(), height: frameHeight() };
  return {
    frame,
    segment(rgb) {
      try {
        return engine.segment(rgb);
      } catch (error) {
        throw asSegmentationError(error);
      }
    },
    release() {
      engine.free();
    },
  };
}
