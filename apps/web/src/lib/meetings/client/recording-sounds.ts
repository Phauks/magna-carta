/*
 * The audible half of the recording announcement: a synthesized tone, and the words spoken where the
 * browser offers a voice — and the ONE audio device the whole page plays that tone on.
 *
 * THE TONE IS THE FLOOR AND THE VOICE IS BEST EFFORT. Voice availability varies and some browsers
 * have none, so speech is never the only channel and never the record; the tone is the same on every
 * browser, and the screen and the live region carry the words regardless.
 *
 * ONE DEVICE FOR THE PAGE, BECAUSE THE PRESS THAT OPENS IT IS OFTEN ON ANOTHER SCREEN. Safari, and
 * every browser on iOS, leaves an audio context suspended unless it was created or resumed while the
 * person was pressing something. A member who joins from a calendar entry presses Join THERE; what
 * reaches the room is the navigation that press caused, and the room's arrival runs from an effect
 * after the press is over. A device the room made for itself would therefore be made outside any
 * press and stay silent for the whole meeting. So the device is held here, once per page, and any
 * press that leads into a room — the entry's Join and Start, the Meetings page's Join, the room's own
 * Join and Rejoin — unlocks `pageRecordingSounds` before it navigates or awaits anything. The room's
 * client is given a HOLD on this same device, so its first chime lands on the device that press woke.
 *
 * A ROOM LETS GO OF ITS OWN HOLD, NEVER OF THE DEVICE. A room's teardown runs after the press that
 * leads out of it: moving from one meeting to another on the same screen, the next room's Join has
 * already woken the device when the last room's client is disposed. A teardown that closed the device
 * outright closed the one that press had just woken, and the next room stayed silent until somebody
 * pressed something again. So every client takes a hold (`hold()`), a press with no room behind it yet
 * stands as a claim of its own until a room takes the device over, and the device closes only when no
 * hold and no such claim is left.
 */

/** The tone and the voice, as the recording concern reaches them. */
export interface MeetingRecordingSounds {
  /**
   * Open the audio device and ask it to run. Called from inside a press — Join, Start, Rejoin, or
   * any press in the room — because that is the only moment some browsers let a page start making
   * sound.
   */
  unlock: () => void;
  /**
   * Two short rising notes for a recording found running, one lower note for one that stopped —
   * now, or not at all.
   */
  chime: (occasion: "started" | "stopped") => void;
  /** Say the sentence aloud, where the platform can. */
  speak: (sentence: string) => void;
  /**
   * Let go of the audio device, for a meeting that is over. It closes only when nothing else holds
   * it, and the next press opens it again.
   */
  release: () => void;
}

/**
 * The page's one device, as the presses and the rooms reach it. Its own `unlock` is a press with no
 * room behind it yet — the calendar entry's Join, the Meetings page's Join. Its own `release` is the
 * PAGE letting go: the device closes whatever holds it, and every hold is given back with it. No room
 * reaches either of those two — a room takes a hold and gives back only that — so the one release
 * that closes the device outright is out of every room's reach; a test resets the page with it.
 */
export interface SharedRecordingSounds extends MeetingRecordingSounds {
  /**
   * A room's hold on the device. The hold is taken by the room's first `unlock` and given back by its
   * `release`; giving it back closes the device only when no other hold, and no press waiting for a
   * room, is left. A hold given back is taken again by its next `unlock`, as a Rejoin does.
   */
  hold: () => MeetingRecordingSounds;
}

/** Sounds that make none, for a client built without a browser behind it. */
export const SILENT_RECORDING_SOUNDS: MeetingRecordingSounds = Object.freeze({
  unlock: () => {},
  chime: () => {},
  speak: () => {},
  release: () => {},
});

/** How long one note of the tone sounds, in seconds of the audio clock. */
const NOTE_SECONDS = 0.14;
/** The silence between the start's two notes, in seconds of the audio clock. */
const NOTE_GAP_SECONDS = 0.06;
/** How loud a note peaks, as a gain: audible over a meeting without startling anybody in it. */
const NOTE_PEAK_GAIN = 0.18;
/** How quickly a note reaches its peak, so it does not click on. */
const NOTE_ATTACK_SECONDS = 0.01;
/** The floor an exponential fade is taken to; it cannot reach zero itself. */
const NOTE_FLOOR_GAIN = 0.0001;
/** The start's two notes, rising: a recording found running asks for attention. */
const STARTED_NOTES_HERTZ = [660, 880] as const;
/** The stop's one note, lower: something ended. */
const STOPPED_NOTES_HERTZ = [520] as const;

/** The platform's voice, where it offers one. */
function speechPlatform(): {
  synthesis: SpeechSynthesis;
  Utterance: typeof SpeechSynthesisUtterance;
} | null {
  const synthesis: unknown = Reflect.get(globalThis, "speechSynthesis");
  const Utterance: unknown = Reflect.get(globalThis, "SpeechSynthesisUtterance");
  if (typeof synthesis !== "object" || synthesis === null || typeof Utterance !== "function") {
    return null;
  }
  return {
    synthesis: synthesis as SpeechSynthesis,
    Utterance: Utterance as typeof SpeechSynthesisUtterance,
  };
}

/**
 * The sounds as a real browser makes them: a Web Audio oscillator for the tone, the Web Speech API
 * for the words.
 *
 * SYNTHESIZED, NOT SHIPPED. No audio file is bundled: no asset to lose in a build, no codec, no
 * decode, and the same notes on every browser.
 *
 * THE DEVICE IS OPENED INSIDE A PRESS, NEVER AT THE CHIME. The first chime arrives on a frame off the
 * socket, which is never a press — so a context opened there stays silent for the whole meeting.
 * `unlock` is the only place a context is made. The voice is woken there too, with an empty
 * utterance, which is what lets a later sentence through.
 *
 * A NOTE IS SCHEDULED ONLY ON A CONTEXT THAT IS RUNNING. One still suspended would hold the notes and
 * play them when it is finally resumed — a "Recording in progress" tone a minute late, for a recording
 * that may have stopped since. A chime that cannot sound now does not sound; the banner and the live
 * region, which always work, carry the announcement alone.
 *
 * HELD, NOT OWNED. Every room's client takes a hold and gives it back when its meeting is over; the
 * device closes when the last hold is given back and no press is waiting for a room to take it over.
 *
 * A factory, so a test can hold a device of its own; the page holds one, `pageRecordingSounds`.
 */
export function browserRecordingSounds(): SharedRecordingSounds {
  let context: AudioContext | null = null;
  /** Whether the voice has been woken from inside a press. Once is enough for the document. */
  let voiceWoken = false;
  /** The rooms holding the device: each hold that has unlocked it and not let go since. */
  const holders = new Set<object>();
  /**
   * Whether a press with no room behind it yet has woken the device. It stands until a room takes the
   * device over by unlocking its hold, so the teardown of the room being left cannot close the device
   * the press into the next one woke.
   */
  let pressAwaitingRoom = false;

  function wakeVoice(): void {
    if (voiceWoken) return;
    const voice = speechPlatform();
    if (voice === null) return;
    voiceWoken = true;
    try {
      voice.synthesis.speak(new voice.Utterance(""));
    } catch {
      // Best effort by construction: a browser that will not speak changes nothing else.
    }
  }

  function wake(): void {
    wakeVoice();
    if (context === null) {
      const Context: unknown = Reflect.get(globalThis, "AudioContext");
      if (typeof Context !== "function") return;
      try {
        context = new (Context as typeof AudioContext)();
      } catch {
        return;
      }
    }
    // Asked every time, not only after creating it: a phone suspends a running context when a call
    // comes in or the page goes to the background, and the next press is what brings it back.
    if (context.state !== "running") void context.resume().catch(() => {});
  }

  /** Close the device, but only once nothing holds it and no press is waiting for a room. */
  function closeWhenUnheld(): void {
    if (holders.size > 0 || pressAwaitingRoom) return;
    const held = context;
    context = null;
    if (held !== null) void held.close().catch(() => {});
  }

  function chime(occasion: "started" | "stopped"): void {
    const output = context;
    if (output?.state !== "running") return;
    try {
      let at = output.currentTime;
      for (const hertz of occasion === "started" ? STARTED_NOTES_HERTZ : STOPPED_NOTES_HERTZ) {
        const oscillator = output.createOscillator();
        const gain = output.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = hertz;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(NOTE_PEAK_GAIN, at + NOTE_ATTACK_SECONDS);
        gain.gain.exponentialRampToValueAtTime(NOTE_FLOOR_GAIN, at + NOTE_SECONDS);
        oscillator.connect(gain).connect(output.destination);
        oscillator.start(at);
        oscillator.stop(at + NOTE_SECONDS);
        at += NOTE_SECONDS + NOTE_GAP_SECONDS;
      }
    } catch {
      // A device that refuses a note is a browser that will not chime; the words still arrive.
    }
  }

  function speak(sentence: string): void {
    const voice = speechPlatform();
    if (voice === null) return;
    try {
      voice.synthesis.speak(new voice.Utterance(sentence));
    } catch {
      // Best effort by construction: a browser with no voice changes nothing else.
    }
  }

  return {
    unlock() {
      pressAwaitingRoom = true;
      wake();
    },
    chime,
    speak,
    release() {
      pressAwaitingRoom = false;
      holders.clear();
      closeWhenUnheld();
    },
    hold() {
      const holder = {};
      return {
        unlock() {
          holders.add(holder);
          // The room this press was waiting for has taken the device over.
          pressAwaitingRoom = false;
          wake();
        },
        chime,
        speak,
        release() {
          // A hold given back twice gives back nothing the second time, and never another room's.
          if (!holders.delete(holder)) return;
          closeWhenUnheld();
        },
      };
    },
  };
}

/**
 * The page's one recording tone: what every press leading into a room unlocks, and what each room's
 * client holds and chimes on. Nothing is opened by importing it; the device is made by the first
 * `unlock`.
 */
export const pageRecordingSounds: SharedRecordingSounds = browserRecordingSounds();
