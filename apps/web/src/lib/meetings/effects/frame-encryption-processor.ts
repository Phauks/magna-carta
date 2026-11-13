/*
 * THE BROWSER'S EDGES FOR AN ENCRYPTED MEETING: the key-group engine's WebAssembly, and the worker the
 * frame transform runs in. Everything here is a browser global, which is why it lives beside the other
 * processors rather than in `client/`, where the state machine reaches it through
 * `FrameEncryptionSeams`.
 *
 * Nothing is loaded until an encrypted meeting is joined: the engine is a dynamic import and its module
 * is fetched then, and the worker is started by the first key or the first transform.
 */
import engineUrl from "@magna-carta/mls/src/pkg/mls_core_bg.wasm?url";
import type { FrameEncryptionMessage } from "../client/frame-encryption.worker.ts";
import type { FrameEncryptionSeams } from "../client/meeting-encryption.ts";

/** `RTCRtpScriptTransform`, read off the global because not every browser or typing has it. */
type ScriptTransformConstructor = new (worker: Worker, options: unknown) => unknown;

function scriptTransform(): ScriptTransformConstructor | undefined {
  const constructor: unknown = Reflect.get(globalThis, "RTCRtpScriptTransform");
  return typeof constructor === "function"
    ? (constructor as ScriptTransformConstructor)
    : undefined;
}

export function browserFrameEncryptionSeams(): FrameEncryptionSeams {
  let worker: Worker | null = null;
  const theWorker = (): Worker => {
    worker ??= new Worker(new URL("../client/frame-encryption.worker.ts", import.meta.url), {
      type: "module",
      name: "meeting-frame-encryption",
    });
    return worker;
  };
  const post = (message: FrameEncryptionMessage, transfer: Transferable[] = []): void => {
    theWorker().postMessage(message, transfer);
  };

  return {
    supported: () => scriptTransform() !== undefined,
    async loadEngine() {
      const engine = await import("@magna-carta/mls");
      const response = await fetch(engineUrl);
      if (!response.ok) throw new Error("the key-group engine could not be fetched");
      await engine.ensureReady(await response.arrayBuffer());
      return (identity) => new engine.MeetingGroupSession(identity);
    },
    sendKey(epoch) {
      // A copy is transferred and the group's own is zeroed, so the key lives in one place: the
      // transform's key ring.
      const baseKey = Uint8Array.from(epoch.baseKey);
      epoch.baseKey.fill(0);
      post(
        {
          type: "epoch",
          epoch: epoch.epoch,
          baseKey,
          ownLeafIndex: epoch.ownLeafIndex,
          paused: epoch.pause !== 0,
        },
        [baseKey.buffer],
      );
    },
    clearKeys() {
      if (worker !== null) post({ type: "clear" });
    },
    attach(target, options) {
      const Transform = scriptTransform();
      if (Transform === undefined) return;
      Reflect.set(target, "transform", new Transform(theWorker(), options));
    },
    preferVp8(transceiver) {
      const capabilities = RTCRtpReceiver.getCapabilities?.("video");
      if (capabilities === null || capabilities === undefined) return;
      // VP8 ALONE, with the repair formats that ride beside it: the transform keeps VP8's first bytes
      // readable for the routing service, and a frame of another codec read as VP8 would be sealed
      // at the wrong place.
      const repair = new Set(["video/rtx", "video/red", "video/ulpfec", "video/flexfec-03"]);
      const kept = capabilities.codecs.filter((codec) => {
        const mimeType = codec.mimeType.toLowerCase();
        return mimeType === "video/vp8" || repair.has(mimeType);
      });
      try {
        transceiver.setCodecPreferences(kept);
      } catch {
        // A browser that will not take the list still offers VP8, which every browser carries.
      }
    },
    close() {
      worker?.terminate();
      worker = null;
    },
  };
}
