// Background noise taken out of a meeting microphone: 10 ms of 48 kHz mono audio at a time, the
// speech kept and the fan, the keyboard and the road outside taken out.
//
// The engine is Rust (crates/noise-suppression-core, over nnnoiseless, a pure-Rust port of RNNoise)
// compiled to WebAssembly with its trained weights built in. It runs in an AudioWorklet, on the
// browser's audio thread, so a frame is cleaned in the same 10 ms it covers and nothing leaves the
// member's machine to be cleaned.
//
// AN AUDIO WORKLET CANNOT FETCH. Its global scope has no `fetch`, so the module is compiled on the
// main thread and handed over as a `WebAssembly.Module`, which `ensureReadySync` instantiates where it
// lands. The worklet's scope may also have no `TextDecoder`, which the generated bindings build at
// load; `./text-decoder.ts` stands one in first, and must be imported before this module.
import init, { frameSamples, initSync, Suppressor } from "./pkg/noise_suppression_core.js";

let ready: Promise<unknown> | undefined;
let readySync = false;

/**
 * Load the WebAssembly module once, asynchronously: under Node (tests) pass the bytes, on a main thread
 * pass nothing and the module fetches its own .wasm beside it.
 */
export async function ensureReady(wasmInput?: Uint8Array | ArrayBuffer): Promise<void> {
  if (readySync) return;
  if (ready === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready = wasmInput !== undefined ? init({ module_or_path: wasmInput as any }) : init();
  }
  await ready;
}

/** Load the WebAssembly module once, from a module compiled elsewhere: the audio worklet's way in. */
export function ensureReadySync(module: WebAssembly.Module): void {
  if (readySync || ready !== undefined) return;
  initSync({ module });
  readySync = true;
}

/** The fixed codes a frame can be refused with. Nothing in one carries audio. */
export const NOISE_SUPPRESSION_ERROR_CODES = ["frameLength", "engineFailed"] as const;
export type NoiseSuppressionErrorCode = (typeof NOISE_SUPPRESSION_ERROR_CODES)[number];

export class NoiseSuppressionError extends Error {
  constructor(readonly code: NoiseSuppressionErrorCode) {
    super(code);
    this.name = "NoiseSuppressionError";
  }
}

function asNoiseSuppressionError(error: unknown): NoiseSuppressionError {
  const message = error instanceof Error ? error.message : String(error);
  const code = NOISE_SUPPRESSION_ERROR_CODES.find((candidate) => candidate === message);
  return new NoiseSuppressionError(code ?? "engineFailed");
}

/** One microphone's denoiser. It carries state from frame to frame, so one belongs to one stream. */
export interface NoiseSuppressor {
  /** Samples in one frame, read from the engine so nothing here can drift from it. */
  readonly frameSamples: number;
  /**
   * Clean one frame of samples in [-1, 1] into `output`, and answer how likely it was, from 0 to 1,
   * to hold a voice. Both arrays are exactly `frameSamples` long.
   */
  process(input: Float32Array, output: Float32Array): number;
  /** Release the engine's memory. The suppressor is unusable afterwards. */
  release(): void;
}

/** Make a denoiser. `ensureReady` or `ensureReadySync` must have finished first. */
export function loadNoiseSuppressor(): NoiseSuppressor {
  const engine = new Suppressor();
  return {
    frameSamples: frameSamples(),
    process(input, output) {
      try {
        return engine.process(input, output);
      } catch (error) {
        throw asNoiseSuppressionError(error);
      }
    },
    release() {
      engine.free();
    },
  };
}
