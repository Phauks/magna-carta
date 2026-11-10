/*
 * ONE MEDIA FRAME IN, ONE MEDIA FRAME OUT: what the encrypted meeting's frame transform does to each
 * encoded frame, kept apart from the transform worker so a unit test reaches every byte of it.
 *
 * The cipher is SFrame (RFC 9605) from `@magna-carta/mls/sframe`, keyed from the meeting group's
 * epoch secret (`encryption-group.ts`). This module adds the two things the RFC leaves to the media:
 *
 *   - THE CLEAR PREFIX. The routing service has to find a VP8 keyframe and the picture size to switch
 *     a subscriber between simulcast layers, so the first bytes of a VP8 frame (ten on a keyframe, one
 *     otherwise) stay readable. They are authenticated as metadata, so changing them breaks the frame.
 *     Audio (Opus) is encrypted whole.
 *   - THE DROP. A frame that does not decrypt — no header, a key this browser does not hold, a tag
 *     that does not match — is dropped and never shown. A picture made of somebody else's bytes is the
 *     one thing worse than a frozen tile.
 *
 * WHILE THE GROUP SAYS ENCRYPTION IS PAUSED (a recording, captions or a phone caller), frames go out
 * as they are and arrive as they are: the pause is read from the verified group state, never from the
 * room, so a dishonest server cannot fake one. A frame that arrives while not paused and carries no
 * SFrame header is dropped.
 */
import { SframeKeyRing, vp8ClearPrefixLength, type SframeStream } from "@magna-carta/mls/sframe";

/** What a transform is carrying, which decides the clear prefix. */
export type FrameCodec = "opus" | "vp8";

/** How many leading bytes of a frame stay readable for the routing service. */
export function clearPrefixLength(codec: FrameCodec, frame: Uint8Array): number {
  return codec === "vp8" ? vp8ClearPrefixLength(frame) : 0;
}

function joined(prefix: Uint8Array, rest: Uint8Array): Uint8Array {
  const whole = new Uint8Array(prefix.length + rest.length);
  whole.set(prefix, 0);
  whole.set(rest, prefix.length);
  return whole;
}

/** The keys one browser holds, and the facts its frames are sealed under. */
export class FrameCipher {
  readonly #ring = new SframeKeyRing();
  #ownLeafIndex: number | null = null;
  #paused = false;

  /** A new epoch began: its key becomes the one this browser encrypts under. */
  setEpoch(epoch: number, baseKey: Uint8Array, ownLeafIndex: number, paused: boolean): void {
    this.#ring.addEpoch(epoch, baseKey);
    baseKey.fill(0);
    this.#ownLeafIndex = ownLeafIndex;
    this.#paused = paused;
  }

  /** Out of the group: nothing is sent or shown until a new epoch arrives. */
  clear(): void {
    this.#ring.clear();
    this.#ownLeafIndex = null;
    this.#paused = false;
  }

  /**
   * One of this browser's own frames, sealed for the room — or `undefined` when there is no key yet,
   * in which case the frame is not sent at all.
   */
  async seal(
    codec: FrameCodec,
    stream: SframeStream,
    frame: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    if (this.#paused) return frame;
    const leaf = this.#ownLeafIndex;
    if (leaf === null || this.#ring.currentEpoch === undefined) return undefined;
    const prefix = frame.subarray(0, clearPrefixLength(codec, frame));
    const sealed = await this.#ring.encrypt(leaf, stream, prefix, frame.subarray(prefix.length));
    return joined(prefix, sealed);
  }

  /** Somebody else's frame, opened — or `undefined` when it must be dropped. */
  async open(codec: FrameCodec, frame: Uint8Array): Promise<Uint8Array | undefined> {
    const prefixLength = clearPrefixLength(codec, frame);
    const prefix = frame.subarray(0, prefixLength);
    const opened = await this.#ring.decrypt(prefix, frame.subarray(prefixLength));
    if (opened !== undefined) return joined(prefix, opened);
    // A frame in the clear is shown only while the group says encryption is paused. A sender that
    // has not yet heard of a resume sends in the clear for a moment, and that moment is dropped.
    return this.#paused ? frame : undefined;
  }
}
