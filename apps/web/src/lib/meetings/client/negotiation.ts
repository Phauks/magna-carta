/*
 * The one peer connection, and the chain that keeps every description applied one at a time.
 *
 * TWO SESSION DESCRIPTIONS APPLIED CONCURRENTLY IS AN INVALID-STATE ERROR the browser reports from
 * whichever one lost, and the one that loses is usually this browser's own publish — so a member who
 * publishes as somebody else joins is left in the room seeing everybody while nobody sees them. The
 * ordering is therefore made explicit here rather than left to the order frames happen to arrive in:
 * everything that renegotiates goes through `enqueue`, and the chain survives a step that fails.
 *
 * ONE CONNECTION, NOT TWO. A screen share is a second local video track on the same connection
 * rather than a connection of its own — one connection is one negotiation, and two would have to be
 * kept in step.
 */
import type { SessionDescription } from "./signaling.ts";

export class MeetingNegotiation {
  readonly #onProblem: (problem: string) => void;
  #peerConnection: RTCPeerConnection | null = null;

  /**
   * Everything that renegotiates runs here, one after another: the frames that arrive, and this
   * browser's own publishes.
   */
  #work: Promise<void> = Promise.resolve();

  constructor(onProblem: (problem: string) => void) {
    this.#onProblem = onProblem;
  }

  open(peerConnection: RTCPeerConnection): void {
    this.#peerConnection = peerConnection;
  }

  /** The connection, or null where there is none — which every caller has to be able to answer. */
  get connection(): RTCPeerConnection | null {
    return this.#peerConnection;
  }

  close(): void {
    this.#peerConnection?.close();
    this.#peerConnection = null;
  }

  /**
   * Run a negotiation step after every step already queued, and record it where one does not finish.
   *
   * A step that throws leaves the connection where it was — the room is still there and the next
   * frame is still worth applying — so the chain is kept alive rather than broken. What it must not
   * do is vanish: a swallowed invalid-state error is a member sitting in front of a picture that
   * never arrives with nothing on the screen saying why.
   */
  enqueue(problem: string, task: () => Promise<void>): Promise<void> {
    const step = this.#work.then(task).catch(() => {
      this.#onProblem(problem);
    });
    this.#work = step;
    return step;
  }

  /** Make this browser's own offer and describe what it put on the connection. */
  async offer(peerConnection: RTCPeerConnection): Promise<SessionDescription> {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    return this.describeLocal(peerConnection);
  }

  /** Answer a description the far side offered, and describe the answer for the frame that carries it. */
  async answer(peerConnection: RTCPeerConnection): Promise<SessionDescription> {
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    return this.describeLocal(peerConnection);
  }

  /** Apply a description the room sent. Nothing is owed in return. */
  async applyRemote(sessionDescription: SessionDescription | null): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || sessionDescription === null) return;
    await peerConnection.setRemoteDescription(sessionDescription);
  }

  /** The transceiver a media section landed on, once the offer carrying it has been applied. */
  transceiverFor(mid: string): RTCRtpTransceiver | undefined {
    return this.#peerConnection?.getTransceivers().find((candidate) => candidate.mid === mid);
  }

  /**
   * What this browser has just put on its own connection, as a frame carries it.
   *
   * THE TYPE IS READ, NEVER ASSUMED. It used to fall back to "offer" where the browser had no local
   * description — which is a lie on every answering path, and the unit given an answer labelled as
   * an offer refuses the whole renegotiation. A connection that cannot describe itself has nothing
   * true to send, so it fails the step it is in and the reason reaches the screen.
   */
  describeLocal(peerConnection: RTCPeerConnection): SessionDescription {
    const local = peerConnection.localDescription;
    if (local === null) {
      throw new Error("The browser did not describe its own connection.");
    }
    return { type: local.type, sdp: local.sdp };
  }
}
