/*
 * THE ENCRYPTED MEETING'S FRAME TRANSFORM, in a worker: every encoded frame this browser sends is
 * sealed here, and every one it receives is opened here or dropped. It runs as the
 * `RTCRtpScriptTransform` on each sender and receiver of an encrypted meeting, so a frame never
 * crosses the main thread on its way through.
 *
 * Security code, kept as small as the job: the cipher and its rules are `frame-encryption.ts`, which
 * a unit test reaches byte for byte. This file only moves frames and keys.
 *
 * THE KEYS ARRIVE BY MESSAGE, one epoch at a time, from the group client on the main thread, with the
 * key's bytes transferred rather than copied; the cipher zeroes its copy once the key ring holds it.
 * Nothing here is written anywhere, and nothing about a frame is reported back.
 */
import type { SframeStream } from "@magna-carta/mls/sframe";
import { FrameCipher, type FrameCodec } from "./frame-encryption.ts";

/** What the main thread tells this worker. */
export type FrameEncryptionMessage =
  | {
      readonly type: "epoch";
      readonly epoch: number;
      readonly baseKey: Uint8Array;
      readonly ownLeafIndex: number;
      readonly paused: boolean;
    }
  | { readonly type: "clear" };

/** What each transform is told when it is attached to a sender or a receiver. */
export interface FrameTransformOptions {
  readonly direction: "send" | "receive";
  readonly codec: FrameCodec;
  readonly stream: SframeStream;
}

interface EncodedFrame {
  data: ArrayBuffer;
}

interface ScriptTransformer {
  readonly readable: ReadableStream<EncodedFrame>;
  readonly writable: WritableStream<EncodedFrame>;
  readonly options: FrameTransformOptions;
}

// The worker's global is typed as a window by the app's DOM library; these are the members a
// transform worker has.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FrameEncryptionMessage>) => void) | null;
  onrtctransform: ((event: { readonly transformer: ScriptTransformer }) => void) | null;
};

const cipher = new FrameCipher();

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "epoch") {
    cipher.setEpoch(message.epoch, message.baseKey, message.ownLeafIndex, message.paused);
  } else {
    cipher.clear();
  }
};

scope.onrtctransform = (event) => {
  const { readable, writable, options } = event.transformer;
  const transform = new TransformStream<EncodedFrame, EncodedFrame>({
    async transform(frame, controller) {
      const bytes = new Uint8Array(frame.data);
      const result =
        options.direction === "send"
          ? await cipher.seal(options.codec, options.stream, bytes)
          : await cipher.open(options.codec, bytes);
      // Undefined is a frame that must not travel: no key yet to send it under, or one that did not
      // open. Not enqueuing it is the drop.
      if (result === undefined) return;
      // A fresh buffer holding exactly the frame, which is what an encoded frame's data must be.
      frame.data = Uint8Array.from(result).buffer;
      controller.enqueue(frame);
    },
  });
  void readable.pipeThrough(transform).pipeTo(writable);
};
