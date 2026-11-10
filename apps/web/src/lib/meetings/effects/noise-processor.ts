/*
 * The browser half of the product's noise filter: route the microphone through the audio worklet that
 * cleans it, and answer the track the room should hear instead.
 *
 * THE GRAPH. The microphone's track feeds a source node, the source feeds the worklet, and the worklet
 * feeds a stream destination whose track is the one published. Everything runs at 48 kHz, the only
 * rate the filter was trained at, so the browser resamples the microphone once on the way in and
 * never inside the filter.
 *
 * THE MICROPHONE ITSELF IS NOT OWNED HERE. Whoever captured it stops it; closing the filter stops only
 * the track it made and the audio context behind it, so turning the filter off never turns the
 * microphone off.
 *
 * A CONTEXT THAT WILL NOT RUN IS A REFUSAL. A browser may hold an audio context suspended until the
 * page has been pressed; a filter whose context never starts would publish silence, so a context still
 * suspended after a short wait is a failure to start and the member stays on their own microphone.
 */
import engineUrl from "@magna-carta/noise-suppression/src/pkg/noise_suppression_core_bg.wasm?url";
import type { NoiseSeams, NoiseTreatment } from "../client/noise-removal.ts";
import { NOISE_REMOVAL_PROCESSOR } from "./noise-frames.ts";
import workletUrl from "./noise-removal.worklet.ts?worker&url";

/** The rate the filter works at. */
const SAMPLE_RATE = 48_000;

/** How long a suspended context is given to start before the filter is refused. */
const START_WAIT_MILLISECONDS = 1_000;

/** Whether this browser can run the filter: an audio worklet and WebAssembly. */
export function noiseRemovalSupported(): boolean {
  return (
    typeof AudioContext === "function" &&
    typeof AudioWorkletNode === "function" &&
    typeof WebAssembly === "object" &&
    typeof WebAssembly.compileStreaming === "function"
  );
}

// The engine is compiled once per page and kept: a member who turns the filter off and on again, or
// rejoins, does not fetch or compile it a second time.
let compiled: Promise<WebAssembly.Module> | undefined;

function compiledEngine(): Promise<WebAssembly.Module> {
  if (compiled === undefined) {
    compiled = WebAssembly.compileStreaming(fetch(engineUrl));
    compiled.catch(() => {
      compiled = undefined;
    });
  }
  return compiled;
}

/** The context's state now, read through a call so a check after an await is not narrowed away. */
function stateOf(context: AudioContext): AudioContextState {
  return context.state;
}

/** Wait for the context to run, or give up after a short wait. */
async function running(context: AudioContext): Promise<void> {
  if (stateOf(context) === "running") return;
  await Promise.race([
    context.resume(),
    new Promise((resolve) => setTimeout(resolve, START_WAIT_MILLISECONDS)),
  ]);
  if (stateOf(context) !== "running") throw new Error("suspended");
}

/** Wait for the worklet's first answer: ready, or that the engine would not load. */
function ready(node: AudioWorkletNode): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (event: MessageEvent<{ type: string }>): void => {
      node.port.removeEventListener("message", listener);
      if (event.data.type === "ready") resolve();
      else reject(new Error("engine"));
    };
    node.port.addEventListener("message", listener);
    node.port.start();
  });
}

/** Start filtering one microphone. Rejects where the filter cannot start. */
export async function startNoiseRemoval(microphone: MediaStreamTrack): Promise<NoiseTreatment> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  try {
    const [module] = await Promise.all([
      compiledEngine(),
      context.audioWorklet.addModule(workletUrl),
    ]);
    const node = new AudioWorkletNode(context, NOISE_REMOVAL_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { module },
    });
    const loaded = ready(node);
    const source = context.createMediaStreamSource(new MediaStream([microphone]));
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    source.connect(node);
    node.connect(destination);
    await loaded;
    await running(context);
    const [track] = destination.stream.getAudioTracks();
    if (track === undefined) throw new Error("graph");

    const failureListeners: Array<() => void> = [];
    let closed = false;
    const failed = (): void => {
      if (closed) return;
      for (const listener of failureListeners) listener();
    };
    node.port.addEventListener("message", (event: MessageEvent<{ type: string }>) => {
      if (event.data.type === "failed") failed();
    });
    node.addEventListener("processorerror", failed);
    context.addEventListener("statechange", () => {
      // A context the browser closed or interrupted (a device change, the tab put to sleep on a
      // phone) is sending nothing, so the member goes back to their own microphone.
      if (context.state !== "running" && context.state !== "suspended") failed();
    });

    return {
      track,
      onFailure(listener) {
        failureListeners.push(listener);
      },
      close() {
        if (closed) return;
        closed = true;
        track.stop();
        source.disconnect();
        node.disconnect();
        node.port.close();
        void context.close();
      },
    };
  } catch (error) {
    void context.close();
    throw error;
  }
}

/** The noise stage's edges, as a real browser supplies them. */
export function browserNoiseSeams(): NoiseSeams {
  return {
    supported: noiseRemovalSupported,
    start: startNoiseRemoval,
    createStream: (tracks) => new MediaStream(tracks),
  };
}
