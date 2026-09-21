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
 *
 * THE HAND IS THE THIRD FACT ON THE SAME FRAME, AND IT ANSWERS TO A DIFFERENT RULE. A presence frame
 * carries `speaking`, `muted` and — where this browser has something to say about it — `hand`: three
 * things one browser measures about one person at one moment, which is why the hand does not get a
 * frame of its own. What differs is what the room does with each: a `speaking` or `muted` change
 * inside the room's window is DROPPED and loses nothing, because the next frame restates it, while a
 * change of hand is REFUSED and re-sent, because nothing later restates it. So the hand is stated by
 * `reactions.svelte.ts`, which owns that window, and this module states the two the meter measures.
 * What it keeps for the other half is `announced()`: a hand frame has to carry the whole of what a
 * presence frame is about, and the last pair told to the room is what that is.
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

  /**
   * The two facts the room was last told, for a frame that states the hand.
   *
   * Nothing has been measured before the first capture, and a browser that declined its microphone
   * never measures anything at all — so the answer then is "not speaking, not muted", which is what
   * a roster row without the two booleans has always meant.
   */
  announced(): { readonly speaking: boolean; readonly muted: boolean } {
    return this.#announced ?? { speaking: false, muted: false };
  }

  stop(): void {
    this.#meter?.stop();
    this.#meter = null;
    this.#announced = null;
  }
}
