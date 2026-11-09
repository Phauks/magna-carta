/*
 * The browser half of a replaced or blurred background: hand the camera to the background worker
 * and answer the track the room should see instead.
 *
 * TWO ROUTES, ONE WORKER. Where the browser can turn a camera track into a stream of frames and a
 * stream of frames back into a track (`MediaStreamTrackProcessor` and `MediaStreamTrackGenerator`),
 * both streams are transferred to the worker and no frame ever touches the main thread. Elsewhere a
 * hidden video element plays the camera, each new frame is copied to an `ImageBitmap` and sent over,
 * and what comes back is painted into a canvas whose own track is the one published. The second route
 * is slower and is throttled in a hidden tab, which is why the first is preferred wherever it exists.
 *
 * THE CAMERA ITSELF IS NOT OWNED HERE. Whoever captured it stops it; closing a processor stops only
 * the track it made and the worker behind it, so turning an effect off never turns the camera off.
 */
import type { BackgroundSeams } from "../client/background-effects.ts";
import type { BackgroundMode } from "./background-compositing.ts";
import { loadBackgroundImage } from "./background-image-store.ts";

/** What the main thread asks of the background worker. */
export type BackgroundWorkerRequest =
  | {
      readonly type: "start";
      readonly width: number;
      readonly height: number;
      readonly mode: BackgroundMode;
      readonly image: ImageBitmap | null;
      readonly input?: ReadableStream<VideoFrame>;
      readonly output?: WritableStream<VideoFrame>;
    }
  | {
      readonly type: "background";
      readonly mode: BackgroundMode;
      readonly image: ImageBitmap | null;
    }
  | { readonly type: "frame"; readonly frame: ImageBitmap }
  | { readonly type: "stop" };

/** What the background worker answers. */
export type BackgroundWorkerReply =
  | { readonly type: "ready" }
  | { readonly type: "frame"; readonly frame: ImageBitmap }
  | { readonly type: "failed"; readonly reason: "engine" | "graphics" };

/** A running background treatment of one camera track. */
export interface BackgroundProcessor {
  /** The treated picture: the track to publish in place of the camera's own. */
  readonly track: MediaStreamTrack;
  /** Change what is behind the member. A picture given here replaces the one held. */
  setBackground(mode: Exclude<BackgroundMode, "none">, image: ImageBitmap | null): void;
  /** Called once if the treatment stops working, so the room can go back to the camera's own picture. */
  onFailure(listener: () => void): void;
  /** Stop the treated track and the worker. The camera is left exactly as it was. */
  close(): void;
}

// The two constructors the fast route needs, read off the global rather than named, because the DOM
// typings this app is built against do not declare them and a browser without them must not throw.
interface TrackProcessorConstructor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
}
interface TrackGeneratorConstructor {
  new (init: { kind: "video" }): MediaStreamTrack & { writable: WritableStream<VideoFrame> };
}

function trackProcessor(): TrackProcessorConstructor | null {
  const found: unknown = Reflect.get(globalThis, "MediaStreamTrackProcessor");
  return typeof found === "function" ? (found as TrackProcessorConstructor) : null;
}

function trackGenerator(): TrackGeneratorConstructor | null {
  const found: unknown = Reflect.get(globalThis, "MediaStreamTrackGenerator");
  return typeof found === "function" ? (found as TrackGeneratorConstructor) : null;
}

/** Whether this browser can blur or replace a background at all: a worker that can draw with WebGL 2. */
export function backgroundEffectsSupported(): boolean {
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return false;
  if (typeof createImageBitmap !== "function") return false;
  try {
    return new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

/** Whether the camera can be handed to the worker as a stream (the route with no main-thread work). */
function canStreamFrames(): boolean {
  if (trackProcessor() === null || trackGenerator() === null) return false;
  // Transferring a stream to a worker is its own feature; a browser with the two constructors and
  // without this would fail at the `postMessage`, so it is asked rather than assumed.
  try {
    const { port1 } = new MessageChannel();
    const probe = new ReadableStream();
    port1.postMessage(probe, [probe as unknown as Transferable]);
    port1.close();
    return true;
  } catch {
    return false;
  }
}

/** Wait for the worker's first answer: ready, or the reason it cannot start. */
function started(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (event: MessageEvent<BackgroundWorkerReply>): void => {
      if (event.data.type === "ready") {
        worker.removeEventListener("message", listener);
        resolve();
      } else if (event.data.type === "failed") {
        worker.removeEventListener("message", listener);
        reject(new Error(event.data.reason));
      }
    };
    worker.addEventListener("message", listener);
    worker.addEventListener("error", () => reject(new Error("engine")), { once: true });
  });
}

/**
 * Start treating one camera track. Rejects where the worker cannot start (the engine would not load,
 * or this browser cannot draw in a worker); the caller then keeps publishing the camera as it is.
 */
export async function startBackgroundProcessor(
  camera: MediaStreamTrack,
  mode: Exclude<BackgroundMode, "none">,
  image: ImageBitmap | null,
): Promise<BackgroundProcessor> {
  const settings = camera.getSettings();
  const width = settings.width ?? 1280;
  const height = settings.height ?? 720;
  const worker = new Worker(new URL("./background-effects.worker.ts", import.meta.url), {
    type: "module",
  });
  const failureListeners: Array<() => void> = [];
  let closed = false;
  const failed = (): void => {
    if (closed) return;
    for (const listener of failureListeners) listener();
  };

  const Processor = trackProcessor();
  const Generator = trackGenerator();
  let track: MediaStreamTrack;
  let stopRoute: () => void;

  try {
    if (Processor !== null && Generator !== null && canStreamFrames()) {
      // The fast route: the worker reads the camera and writes the treated track itself.
      // The camera itself, not a copy: a camera turned off then reads as black frames here too,
      // so the room never sees a picture the member switched off.
      const input = new Processor({ track: camera });
      const output = new Generator({ kind: "video" });
      const ready = started(worker);
      worker.postMessage(
        {
          type: "start",
          width,
          height,
          mode,
          image,
          input: input.readable,
          output: output.writable,
        },
        [
          input.readable as unknown as Transferable,
          output.writable as unknown as Transferable,
          ...(image === null ? [] : [image]),
        ],
      );
      await ready;
      track = output;
      stopRoute = () => undefined;
    } else {
      ({ track, stop: stopRoute } = await startBitmapRoute(
        worker,
        camera,
        width,
        height,
        mode,
        image,
      ));
    }
  } catch (error) {
    worker.terminate();
    throw error;
  }

  worker.addEventListener("message", (event: MessageEvent<BackgroundWorkerReply>) => {
    if (event.data.type === "failed") failed();
  });
  worker.addEventListener("error", failed);

  return {
    track,
    setBackground(nextMode, nextImage) {
      worker.postMessage(
        { type: "background", mode: nextMode, image: nextImage },
        nextImage === null ? [] : [nextImage],
      );
    },
    onFailure(listener) {
      failureListeners.push(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      stopRoute();
      track.stop();
      worker.postMessage({ type: "stop" });
      // A worker that does not stop on request is still stopped.
      setTimeout(() => worker.terminate(), 1000);
    },
  };
}

/**
 * The portable route: a hidden video element plays the camera, each new frame goes to the
 * worker as a bitmap, and what comes back is painted into a canvas whose track is published.
 *
 * ONE FRAME IN FLIGHT AT A TIME. A frame that arrives while the worker is still drawing the last is
 * skipped rather than queued, so a slow machine shows a lower frame rate rather than a growing delay.
 */
async function startBitmapRoute(
  worker: Worker,
  camera: MediaStreamTrack,
  width: number,
  height: number,
  mode: Exclude<BackgroundMode, "none">,
  image: ImageBitmap | null,
): Promise<{ track: MediaStreamTrack; stop: () => void }> {
  const ready = started(worker);
  worker.postMessage({ type: "start", width, height, mode, image }, image === null ? [] : [image]);
  await ready;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([camera]);
  await video.play();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const painter = canvas.getContext("bitmaprenderer");
  if (painter === null) throw new Error("graphics");
  const [track] = canvas.captureStream(30).getVideoTracks();
  if (track === undefined) throw new Error("graphics");

  let running = true;
  let inFlight = false;

  worker.addEventListener("message", (event: MessageEvent<BackgroundWorkerReply>) => {
    if (event.data.type !== "frame") return;
    inFlight = false;
    if (running) painter.transferFromImageBitmap(event.data.frame);
    else event.data.frame.close();
  });

  const next = (): void => {
    if (!running) return;
    if (!inFlight && video.readyState >= 2) {
      inFlight = true;
      createImageBitmap(video).then(
        (frame) => {
          if (running) worker.postMessage({ type: "frame", frame }, [frame]);
          else frame.close();
        },
        () => {
          inFlight = false;
        },
      );
    }
    schedule();
  };
  const schedule = (): void => {
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(next);
    } else {
      requestAnimationFrame(next);
    }
  };
  schedule();

  return {
    track,
    stop() {
      running = false;
      video.pause();
      video.srcObject = null;
    },
  };
}

/** The background stage's edges, as a real browser supplies them. */
export function browserBackgroundSeams(): BackgroundSeams {
  return {
    supported: backgroundEffectsSupported,
    start: startBackgroundProcessor,
    loadImage: loadBackgroundImage,
    copyImage: (image) => createImageBitmap(image),
    createStream: (tracks) => new MediaStream(tracks),
  };
}
