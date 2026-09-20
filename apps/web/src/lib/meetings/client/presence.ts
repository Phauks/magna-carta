/*
 * What this browser says about its own microphone, and when it says it.
 *
 * WHO IS TALKING IS MEASURED ONCE, AT THE SOURCE. Each browser measures the one microphone it owns
 * and tells the room; the room relays the answer to everybody else. Measuring it on the receiving
 * side would be an analyser per incoming track — three hundred of them in a full room, for one
 * boolean each — and it could only ever cover the few tracks already being pulled, which is the
 * wrong set: whoever speaks next is usually somebody nobody is currently listening to.
 *
 * AND IT IS SAID ON TRANSITIONS ONLY. A frame per measurement would be twenty frames a second from
 * every person in the room; a frame per change is a handful per sentence. The room throttles what it
 * relays on top of this, but a client that sent the same fact over and over would be spending a room
 * of three hundred's whole signalling budget on saying nothing.
 */
import type { AudioLevelMeter } from "./audio-level-meter.ts";

export class MeetingPresence {
  /** The running measurement of this browser's own microphone. Null before anything is captured. */
  #meter: AudioLevelMeter | null = null;
  /** The last presence this browser told the room, so only a CHANGE is announced. */
  #announced: { speaking: boolean; muted: boolean } | null = null;

  /**
   * Watch a captured stream's microphone.
   *
   * The meter runs on the CAPTURED track rather than on what is being sent, so a member who mutes
   * is reported muted rather than silently not-speaking — the two read differently on a tile and
   * mean different things to the person looking at it. A muted microphone still makes sound the
   * meter can hear; nobody else can hear it, so it is not speech as far as the room is concerned,
   * which is what `microphoneOn` decides.
   */
  watch(
    stream: MediaStream,
    createMeter: (track: MediaStreamTrack) => AudioLevelMeter,
    microphoneOn: () => boolean,
    announce: (speaking: boolean, muted: boolean) => void,
  ): void {
    const [microphone] = stream.getAudioTracks();
    if (microphone === undefined) return;
    this.#meter?.stop();
    const meter = createMeter(microphone);
    this.#meter = meter;
    meter.start((speaking) => {
      announce(speaking && microphoneOn(), !microphoneOn());
    });
  }

  /** Whether this is news. False for a restatement of what the room was already told. */
  isTransition(speaking: boolean, muted: boolean): boolean {
    const last = this.#announced;
    return last === null || last.speaking !== speaking || last.muted !== muted;
  }

  /** Record what has just been told to the room, so the next restatement of it is not sent. */
  noteAnnounced(speaking: boolean, muted: boolean): void {
    this.#announced = { speaking, muted };
  }

  stop(): void {
    this.#meter?.stop();
    this.#meter = null;
    this.#announced = null;
  }
}
