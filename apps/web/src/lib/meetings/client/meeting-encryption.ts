/*
 * AN ENCRYPTED MEETING, IN THIS BROWSER: the key group and the frame transform, joined up.
 *
 * `encryption-group.ts` agrees each epoch's key with everybody else in the room; the frame transform
 * (`frame-encryption.worker.ts`) seals every frame this browser sends and opens every one it receives
 * under that key. This module is what the client composes: it loads the engine, builds the group once
 * the room has welcomed this socket, hands every epoch's key to the transform, and puts the transform
 * on every sender and receiver the connection holds before a frame can cross it.
 *
 * THE BROWSER IS REACHED THROUGH `FrameEncryptionSeams`, so a test runs the whole of this with the
 * real engine and a fake transform. A browser that cannot run a frame transform cannot be in an
 * encrypted meeting at all, and the client is told so before anything is captured: its pictures would
 * reach nobody, and nothing anybody else sent would open here.
 */
import type { SframeStream } from "@magna-carta/mls/sframe";
import {
  EncryptionGroup,
  type GroupEpoch,
  type GroupSession,
  type GroupStanding,
} from "./encryption-group.ts";
import type { FrameCodec } from "./frame-encryption.ts";

/** What one transform is told about the sender or receiver it sits on. */
export interface FrameTransformTarget {
  readonly direction: "send" | "receive";
  readonly codec: FrameCodec;
  readonly stream: SframeStream;
}

/** The edges an encrypted meeting reaches the browser through. */
export interface FrameEncryptionSeams {
  /** Whether this browser can put a script transform on a sender and a receiver. */
  supported(): boolean;
  /** The key-group engine, loaded once per page: a function making a session for one stay. */
  loadEngine(): Promise<(identity: string) => GroupSession>;
  /** The epoch's key to the transform. The bytes are handed over, not copied. */
  sendKey(epoch: GroupEpoch): void;
  /** The transform forgets every key, so nothing more is sealed or opened. */
  clearKeys(): void;
  /** Put the transform on one sender or receiver. */
  attach(target: RTCRtpSender | RTCRtpReceiver, options: FrameTransformTarget): void;
  /** Ask a video section for VP8 first: the transform's readable prefix is VP8's. */
  preferVp8(transceiver: RTCRtpTransceiver): void;
  /** The transform's worker is no longer needed. */
  close(): void;
}

/** What the client hears from the encrypted meeting. */
export interface MeetingEncryptionHost {
  send(frame: Record<string, unknown>): void;
  onStanding(standing: GroupStanding): void;
  onEpoch(epoch: GroupEpoch): void;
}

/** A video section carries the camera unless it is carrying the screen share. */
function streamOf(kind: string, track: MediaStreamTrack | null, screen: MediaStreamTrack | null) {
  if (kind === "audio") return "audio" as const;
  return track !== null && track === screen ? ("screen" as const) : ("camera" as const);
}

export class MeetingEncryption {
  readonly #seams: FrameEncryptionSeams;
  readonly #host: MeetingEncryptionHost;
  readonly #covered = new WeakSet<RTCRtpSender | RTCRtpReceiver>();
  #createSession: ((identity: string) => GroupSession) | null = null;
  #group: EncryptionGroup | null = null;
  #liveStays: readonly string[] = [];

  constructor(seams: FrameEncryptionSeams, host: MeetingEncryptionHost) {
    this.#seams = seams;
    this.#host = host;
  }

  /** Whether this browser can be in an encrypted meeting at all. */
  supported(): boolean {
    return this.#seams.supported();
  }

  /** Load the engine before the socket opens, so the welcome finds it ready. */
  async load(): Promise<void> {
    this.#createSession ??= await this.#seams.loadEngine();
  }

  /**
   * The room welcomed this socket: ask to be let into the key group. A rejoin builds a new group,
   * because a stay that came back holds a new identity in the group and none of the old keys.
   */
  start(meetingId: string, ownStay: string): void {
    const createSession = this.#createSession;
    if (createSession === null) return;
    this.#group?.stop();
    this.#group = new EncryptionGroup(meetingId, ownStay, {
      createSession,
      send: (frame) => this.#host.send(frame),
      onEpoch: (epoch) => {
        this.#seams.sendKey(epoch);
        this.#host.onEpoch(epoch);
      },
      onStanding: (standing) => {
        // A browser between keys sends nothing and shows nothing, rather than a frame under a key
        // the group has left.
        if (standing !== "member") this.#seams.clearKeys();
        this.#host.onStanding(standing);
      },
    });
    this.#group.noteLiveStays(this.#liveStays);
    this.#group.start();
  }

  receive(frame: Record<string, unknown>): void {
    this.#group?.receive(frame);
  }

  refused(reason: string): void {
    this.#group?.refused(reason);
  }

  noteLiveStays(stays: readonly string[]): void {
    this.#liveStays = stays;
    this.#group?.noteLiveStays(stays);
  }

  proposePause(bits: number): void {
    this.#group?.proposePause(bits);
  }

  /**
   * Put the transform on every sender and receiver that does not have it yet. Called before every
   * offer this browser makes and after every offer it applies, which are the two moments a new
   * section appears: before the offer, so a frame never leaves unsealed; after the remote one, so a
   * frame is never shown before it is opened.
   */
  cover(peerConnection: RTCPeerConnection, screen: MediaStreamTrack | null): void {
    for (const transceiver of peerConnection.getTransceivers()) {
      const { sender, receiver } = transceiver;
      const sending = sender.track;
      if (sending !== null && !this.#covered.has(sender)) {
        if (sending.kind === "video") this.#seams.preferVp8(transceiver);
        this.#seams.attach(sender, {
          direction: "send",
          codec: sending.kind === "audio" ? "opus" : "vp8",
          stream: streamOf(sending.kind, sending, screen),
        });
        this.#covered.add(sender);
      }
      if (!this.#covered.has(receiver)) {
        const kind = receiver.track.kind;
        this.#seams.attach(receiver, {
          direction: "receive",
          codec: kind === "audio" ? "opus" : "vp8",
          // A receiver opens whatever stream the key identifier names; the stream is the sender's.
          stream: kind === "audio" ? "audio" : "camera",
        });
        this.#covered.add(receiver);
      }
    }
  }

  /** The meeting is over here: the group's keys and the transform's go. */
  stop(): void {
    this.#group?.stop();
    this.#group = null;
    this.#liveStays = [];
    this.#seams.clearKeys();
  }

  close(): void {
    this.stop();
    this.#seams.close();
  }
}
