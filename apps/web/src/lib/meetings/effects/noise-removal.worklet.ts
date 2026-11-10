/*
 * The audio thread's half of the product's noise filter: every 128 samples the browser hands over are
 * gathered into 10 ms frames, cleaned by the WebAssembly engine, and handed back 10 ms later.
 *
 * THE ENGINE ARRIVES COMPILED. An audio worklet cannot fetch, so the main thread compiles the module
 * and passes it in `processorOptions`; it is instantiated here, once, as the processor is made.
 *
 * A FAILURE PASSES THE SOUND THROUGH. If the engine will not load or a frame throws, the processor
 * says so once over its port and from then on copies its input to its output untouched, so the member
 * is heard exactly as their microphone hears them until the main thread swaps the filter out. Nothing
 * about the audio itself is ever sent over the port.
 */
import "@magna-carta/noise-suppression/text-decoder";
import {
  ensureReadySync,
  loadNoiseSuppressor,
  type NoiseSuppressor,
} from "@magna-carta/noise-suppression";
import { FrameBridge, NOISE_REMOVAL_PROCESSOR } from "./noise-frames.ts";

// The worklet scope's globals. The DOM typings this app builds against do not declare them.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(
  name: string,
  processor: new (options: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void;

/** The size of a block the audio thread hands over. */
const BLOCK_SAMPLES = 128;

class NoiseRemovalProcessor extends AudioWorkletProcessor {
  #suppressor: NoiseSuppressor | null = null;
  #bridge: FrameBridge | null = null;
  #failed = false;

  constructor(options: { processorOptions?: unknown }) {
    super(options);
    try {
      const module: unknown = Reflect.get(Object(options.processorOptions), "module");
      if (!(module instanceof WebAssembly.Module)) throw new Error("engine");
      ensureReadySync(module);
      const suppressor = loadNoiseSuppressor();
      this.#suppressor = suppressor;
      this.#bridge = new FrameBridge(suppressor.frameSamples, BLOCK_SAMPLES);
      this.port.postMessage({ type: "ready" });
    } catch {
      this.#fail();
    }
  }

  #fail(): void {
    if (this.#failed) return;
    this.#failed = true;
    this.port.postMessage({ type: "failed" });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output === undefined) return true;
    const suppressor = this.#suppressor;
    const bridge = this.#bridge;
    if (this.#failed || suppressor === null || bridge === null) {
      if (input === undefined) output.fill(0);
      else output.set(input.subarray(0, output.length));
      return true;
    }
    try {
      bridge.push(input, output, (frame, cleaned) => {
        suppressor.process(frame, cleaned);
      });
    } catch {
      this.#fail();
      if (input === undefined) output.fill(0);
      else output.set(input.subarray(0, output.length));
    }
    return true;
  }
}

registerProcessor(NOISE_REMOVAL_PROCESSOR, NoiseRemovalProcessor);
