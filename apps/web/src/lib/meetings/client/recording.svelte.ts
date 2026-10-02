/*
 * A recording of the meeting: whether one is running, the announcement that tells everybody in the
 * room so, and the two acts that start and stop it.
 *
 * THE ANNOUNCEMENT AND THE MARK ARE THE CONSENT MECHANISM, which is why this is a module of its own
 * rather than a flag on the client. The owner ruled that "Recording in progress", said to everyone at
 * the start and to every late arrival, audibly and on screen, with a mark that stays for as long as
 * the recording runs, IS the consent. So the browser's half is built as a mechanism with a contract:
 * one transition, one announcement, through every channel at once — a short synthesized tone, the
 * words spoken where the browser can speak, a banner the member dismisses, and the same sentence in
 * an assertive live region so somebody using a screen reader is told rather than shown.
 *
 * THE ROOM'S FRAME IS WHAT LIGHTS THE MARK, NEVER THE PRESS. Start and stop are routes, and the room
 * broadcasts `recording` to every welcomed socket the instant the route commits — the member who
 * pressed Record included. Lighting the mark on the route's answer would light it on one screen
 * before the room had told anybody else, and the mark is a statement about what EVERYBODY was told.
 * What the server keeps as the record is what it delivered to whom; nothing here is the record.
 *
 * EVERY WELCOME THAT CARRIES A RECORDING IS TOLD; ONLY THE FIRST IS SOUNDED. A socket lost and
 * re-established is welcomed again, and the welcome carries the running recording — the "and on
 * arrival" half of the ruling. The room writes that welcome down as a separate occasion on which this
 * person was told, because the socket that came back may be a different device in a different room
 * from the one that went away. The browser agrees with that record on the conservative side: every
 * welcome naming a running recording draws the banner again and writes the live region again. What
 * is NOT repeated is the tone and the voice — the recording this page has already announced aloud is
 * remembered across the rejoin, so a connection that blinks every few seconds does not chime every few
 * seconds. A welcome naming a different recording, or none where one was running, is a transition,
 * and is announced aloud as one.
 *
 * EVERY TRANSITION IS SPOKEN, EVEN ONE WORDED LIKE THE LAST. An assertive live region is read when
 * its text CHANGES, and a screen reader says nothing when the new text is the old text — so a second
 * "Recording in progress", for a reconnect into a different recording, would reach the banner and
 * the tone and never the reader. The region is therefore emptied at each transition and written a
 * moment later: two changes, the second of which is the sentence. The moment is a short wait rather
 * than the next microtask, because the accessibility tree is rebuilt on the browser's rendering
 * pass, and an empty-then-full within one task reaches it as no change at all.
 *
 * EVERY EDGE IS A SEAM. The tone and the voice are a device and a platform service; the routes are
 * the screen's; the wait before the region is rewritten is a clock. Under a test all three are
 * fakes, and the default for the first two is silence and refusal, so a client built without them —
 * a guest's, which may not start anything — does nothing it was not given the means to do.
 */
import type { MeetingRecordingAnnouncement } from "@magna-carta/meeting-protocol/types";
import type { Failure } from "$lib/api/problem.ts";
import { meetingProblemType, type MeetingWrite } from "../meetings-api.ts";
import { isRecord, readString } from "./signaling.ts";

export type { MeetingRecordingAnnouncement };

/** The words the ruling names, said and announced when a recording starts or is found running. */
export const RECORDING_IN_PROGRESS = "Recording in progress";
/** The words said and announced when it stops. */
export const RECORDING_STOPPED = "Recording stopped";

/**
 * How long the live region stays empty before it is written, in milliseconds: long enough for the
 * browser to have rendered the emptiness, short enough that nobody hears a gap.
 */
export const ANNOUNCEMENT_REWRITE_MILLISECONDS = 100;

/** Wait, then run. Answers with the way to call it off. */
export type MeetingRecordingDelay = (milliseconds: number, run: () => void) => () => void;

/** The wait as a browser keeps it. */
export const browserRecordingDelay: MeetingRecordingDelay = (milliseconds, run) => {
  const waiting = setTimeout(run, milliseconds);
  return () => {
    clearTimeout(waiting);
  };
};

/** What somebody with no name on the announcement is called in a sentence about them. */
const UNNAMED_ACTOR = "Somebody";

/** Which of the three occasions an announcement is: the start, an arrival into it, or the stop. */
export type MeetingRecordingOccasion = "started" | "arrival" | "stopped";

/** The banner across the header: what happened, in a title and one sentence. Dismissible. */
export interface MeetingRecordingNotice {
  readonly occasion: MeetingRecordingOccasion;
  readonly title: string;
  readonly sentence: string;
}

/**
 * One announcement as a frame or a welcome carries it, or null where it is not one.
 *
 * READ DEFENSIVELY AND WHOLE, like every frame in this directory: an announcement missing the handle
 * of the recording it is about cannot be told apart from the last one, so it is not an announcement.
 * The actor is kept even without a member handle — a guest's copy carries `userId: null`, which is
 * the rule every frame naming a firm user follows — and is null only where the room said nobody
 * acted, which is a recording that stopped on its own.
 */
export function readRecordingAnnouncement(value: unknown): MeetingRecordingAnnouncement | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state !== "started" && state !== "stopped") return null;
  const recordingId = readString(value, "recordingId");
  const at = readString(value, "at");
  if (recordingId === null || at === null) return null;
  const by = isRecord(value.by)
    ? {
        userId: readString(value.by, "userId"),
        displayName: readString(value.by, "displayName") ?? "",
      }
    : null;
  return { state, recordingId, by, at };
}

/** Who acted, in a sentence, where the room named anybody. */
function actorName(announcement: MeetingRecordingAnnouncement | null): string | null {
  if (announcement?.by === null || announcement?.by === undefined) return null;
  const name = announcement.by.displayName.trim();
  return name === "" ? UNNAMED_ACTOR : name;
}

/** The banner for one occasion, in the words a member reads. */
export function recordingNotice(
  occasion: MeetingRecordingOccasion,
  announcement: MeetingRecordingAnnouncement | null,
): MeetingRecordingNotice {
  const name = actorName(announcement);
  if (occasion === "stopped") {
    return {
      occasion,
      title: "Recording Stopped",
      sentence:
        name === null
          ? "This meeting is no longer being recorded."
          : `${name} stopped the recording.`,
    };
  }
  if (name === null) {
    return {
      occasion,
      title: "Recording in Progress",
      sentence: "This meeting is being recorded.",
    };
  }
  return {
    occasion,
    title: "Recording in Progress",
    sentence:
      occasion === "started"
        ? `${name} started recording this meeting.`
        : `This meeting is being recorded. ${name} started the recording.`,
  };
}

/**
 * The audible half of the announcement: a synthesized tone, and the words spoken where the browser
 * offers a voice.
 *
 * THE TONE IS THE FLOOR AND THE VOICE IS BEST EFFORT. Voice availability varies and some browsers
 * have none, so speech is never the only channel and never the record; the tone is the same on every
 * browser, and the screen and the live region carry the words regardless.
 */
export interface MeetingRecordingSounds {
  /**
   * Open the audio device and ask it to run. Called from inside a press — Join, Rejoin, or any press
   * in the room — because that is the only moment some browsers let a page start making sound.
   */
  unlock: () => void;
  /**
   * Two short rising notes for a recording found running, one lower note for one that stopped —
   * now, or not at all.
   */
  chime: (occasion: "started" | "stopped") => void;
  /** Say the sentence aloud, where the platform can. */
  speak: (sentence: string) => void;
  /** Let go of the audio device, for a meeting that is over. The next press opens it again. */
  release: () => void;
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
  if (!isRecord(synthesis) || typeof Utterance !== "function") return null;
  return {
    synthesis: synthesis as unknown as SpeechSynthesis,
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
 * THE DEVICE IS OPENED INSIDE A PRESS, NEVER AT THE CHIME. Safari, and every browser on iOS, leaves an
 * audio context suspended unless it was created or resumed while the person was pressing something,
 * and gates speech the same way. The first chime arrives on a frame off the socket, which is never a
 * press — so a context opened there stays silent for the whole meeting. `unlock` is what the screens
 * call from Join, Rejoin and any press in the room, and it is the only place a context is made. The
 * voice is woken there too, with an empty utterance, which is what lets a later sentence through.
 *
 * A NOTE IS SCHEDULED ONLY ON A CONTEXT THAT IS RUNNING. One still suspended would hold the notes and
 * play them when it is finally resumed — a "Recording in progress" tone a minute late, for a recording
 * that may have stopped since. A chime that cannot sound now does not sound; the banner and the live
 * region, which always work, carry the announcement alone.
 */
export function browserRecordingSounds(): MeetingRecordingSounds {
  let context: AudioContext | null = null;
  /** Whether the voice has been woken from inside a press. Once is enough for the document. */
  let voiceWoken = false;

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

  return {
    unlock() {
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
    },
    chime(occasion) {
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
    },
    speak(sentence) {
      const voice = speechPlatform();
      if (voice === null) return;
      try {
        voice.synthesis.speak(new voice.Utterance(sentence));
      } catch {
        // Best effort by construction: a browser with no voice changes nothing else.
      }
    },
    release() {
      const held = context;
      context = null;
      if (held !== null) void held.close().catch(() => {});
    },
  };
}

/**
 * The two acts, as the screen supplies them.
 *
 * ROUTES, NEVER FRAMES. The permission check, the audit row and the recording's own row belong at
 * the server's chokepoint, and the room is told by the route; a frame would put an authorization
 * decision inside the socket protocol. A guest's client is given none, because a guest may start
 * nothing.
 */
export interface MeetingRecordingRoutes {
  start: () => Promise<MeetingWrite<unknown>>;
  stop: () => Promise<MeetingWrite<unknown>>;
}

/** A refused recording act, in the words a member reads. */
export interface MeetingRecordingRefusal {
  readonly title: string;
  readonly sentence: string;
}

/**
 * The problem types a recording act is refused with, by slug, each with what it reads as.
 *
 * Keyed by the slug the server registers, so a refusal it adds later reads as the generic sentence
 * below rather than as the wrong specific one.
 */
const RECORDING_REFUSALS: Readonly<Record<string, MeetingRecordingRefusal>> = Object.freeze({
  "meeting-recording-not-configured": {
    title: "Recording Is Not Switched On",
    sentence: "Recording is not switched on for this firm yet.",
  },
  "meeting-recording-already-running": {
    title: "Already Recording",
    sentence: "This meeting is already being recorded.",
  },
  "meeting-recording-not-running": {
    title: "Not Recording",
    sentence: "This meeting is not being recorded, so there was nothing to stop.",
  },
  "meeting-recording-needs-matter": {
    title: "This Meeting Cannot Be Recorded",
    sentence: "Only a meeting on a matter can be recorded, and this one is on a firm event.",
  },
  "meeting-recording-too-many-tracks": {
    title: "Too Many People to Record",
    sentence: "There are more people speaking in this room than one recording can hold.",
  },
  "meeting-recording-not-permitted": {
    title: "You Cannot Stop This Recording",
    sentence: "Stopping a recording takes the right to record, or hosting this meeting.",
  },
  "meeting-not-host": {
    title: "You Are Not Hosting This Meeting",
    sentence: "Only somebody hosting this meeting can start a recording.",
  },
  "meeting-already-ended": {
    title: "This Meeting Has Ended",
    sentence: "There is nobody left in the room to record.",
  },
});

/** What a refused start or stop reads as. The generic sentence where the server named nothing. */
export function recordingRefusal(
  failure: Failure | null,
  act: "start" | "stop",
): MeetingRecordingRefusal {
  const type = failure?.problem?.type;
  for (const [slug, refusal] of Object.entries(RECORDING_REFUSALS)) {
    if (type === meetingProblemType(slug)) return refusal;
  }
  return act === "start"
    ? { title: "Nothing Changed", sentence: "The recording did not start." }
    : { title: "Nothing Changed", sentence: "The recording did not stop." };
}

export class MeetingRecording {
  /**
   * The recording running in this room, as the room last announced it. Null while nothing is.
   *
   * It is what the mark is drawn from, and it is set by the room's frames and by the welcome alone:
   * the mark says what everybody was told, so nothing this browser did on its own lights it.
   */
  running = $state<MeetingRecordingAnnouncement | null>(null);

  /** The banner across the header, until the member dismisses it or the next transition replaces it. */
  notice = $state<MeetingRecordingNotice | null>(null);

  /**
   * The sentence the assertive live region carries. Emptied at each transition and written again a
   * moment later, so a reader using a screen reader is interrupted with it even where it reads as
   * the last one did. Empty only for that moment: never cleared on a dismissal, because a region
   * left empty is a region some readers announce as empty.
   */
  announcement = $state("");

  /** True while a start is in flight, so the confirmation can stand its ground. */
  starting = $state(false);
  /** True while a stop is in flight, so the control cannot be pressed twice. */
  stopping = $state(false);
  /** What the last start or stop was refused with. Null while nothing has been. */
  writeFailure = $state<Failure | null>(null);
  /** Which of the two acts the refusal above belongs to. */
  refusedAct = $state<"start" | "stop" | null>(null);

  readonly #sounds: MeetingRecordingSounds;
  readonly #after: MeetingRecordingDelay;
  /** Calls off the region's pending rewrite, while one is waiting. */
  #cancelRewrite: (() => void) | null = null;
  #routes: MeetingRecordingRoutes | null = null;
  /**
   * The recording this page has announced ALOUD as running — the tone and the voice.
   *
   * Kept across a lost socket and the rejoin that follows, which is what keeps a connection that
   * blinks from chiming every time it comes back: the welcome after it names the same recording,
   * and the banner and the live region say so again, but the tone has already sounded for that one.
   * Forgotten when the recording stops or the member leaves, because either way the next one is news.
   */
  #announcedAloud: string | null = null;

  constructor(
    sounds: MeetingRecordingSounds = SILENT_RECORDING_SOUNDS,
    after: MeetingRecordingDelay = browserRecordingDelay,
  ) {
    this.#sounds = sounds;
    this.#after = after;
  }

  /** Let the screen's routes be what Record and Stop reach. */
  recordThrough(routes: MeetingRecordingRoutes): void {
    this.#routes = routes;
  }

  /**
   * What the welcome said about a recording: running, or nothing.
   *
   * The "and on arrival" half of the ruling. A running recording is announced as an arrival into it
   * on EVERY welcome, a rejoin into the same one included — the banner drawn again and the live
   * region written again — because the room records each welcome as an occasion this person was
   * told, and the socket that came back may be at another device. Only the tone and the voice are
   * held back for a recording this page has already sounded. A welcome naming none where one was
   * running is the stop this browser did not hear while it was away.
   */
  noteWelcome(announcement: MeetingRecordingAnnouncement | null): void {
    if (announcement !== null && announcement.state === "started") {
      this.running = announcement;
      const aloud = this.#announcedAloud !== announcement.recordingId;
      this.#announcedAloud = announcement.recordingId;
      this.#announce("arrival", announcement, aloud);
      return;
    }
    this.running = null;
    if (this.#announcedAloud === null) return;
    this.#announcedAloud = null;
    this.#announce("stopped", null, true);
  }

  /** The room broadcast a transition. A repeat of the state already held is not one. */
  noteFrame(announcement: MeetingRecordingAnnouncement | null): void {
    if (announcement === null) return;
    if (announcement.state === "started") {
      if (this.running?.recordingId === announcement.recordingId) return;
      this.running = announcement;
      const aloud = this.#announcedAloud !== announcement.recordingId;
      this.#announcedAloud = announcement.recordingId;
      this.#announce("started", announcement, aloud);
      return;
    }
    // A stop for a recording nobody here was told about has nothing to take down and nothing to say.
    if (this.running === null && this.#announcedAloud === null) return;
    this.running = null;
    this.#announcedAloud = null;
    this.#announce("stopped", announcement, true);
  }

  /**
   * Open the audio device and wake the voice, from inside a press. The screens call it from Join,
   * Rejoin and any press in the room; a browser that only lets a page make sound from a press
   * would otherwise never chime.
   */
  unlockSounds(): void {
    this.#sounds.unlock();
  }

  /** The member read the banner. The mark stays: it is the part that lasts as long as the recording. */
  dismiss(): void {
    this.notice = null;
  }

  /**
   * The socket went away. What is drawn goes with it — this browser no longer knows what the room is
   * doing — but which recording was announced aloud is kept, for the welcome that follows a rejoin.
   */
  noteDisconnected(): void {
    this.running = null;
    this.notice = null;
  }

  /** The meeting is over for this browser: everything goes, the audio device included. */
  clear(): void {
    this.running = null;
    this.notice = null;
    this.#cancelRewrite?.();
    this.#cancelRewrite = null;
    this.announcement = "";
    this.#announcedAloud = null;
    this.writeFailure = null;
    this.refusedAct = null;
    this.#sounds.release();
  }

  /**
   * Ask the room to start recording. The mark lights on the room's frame, not on this answer.
   * Answers `committed` or `refused` so the confirmation can close or stand its ground.
   */
  async start(): Promise<"committed" | "refused"> {
    const routes = this.#routes;
    if (routes === null || this.starting) return "refused";
    this.writeFailure = null;
    this.refusedAct = null;
    this.starting = true;
    const outcome = await routes.start();
    this.starting = false;
    if (outcome.kind === "ok") return "committed";
    this.writeFailure = outcome.failure;
    this.refusedAct = "start";
    return "refused";
  }

  /** Ask the room to stop. The mark clears on the room's frame, like it lit on one. */
  async stop(): Promise<boolean> {
    const routes = this.#routes;
    if (routes === null || this.stopping) return false;
    this.writeFailure = null;
    this.refusedAct = null;
    this.stopping = true;
    const outcome = await routes.stop();
    this.stopping = false;
    if (outcome.kind === "ok") return true;
    this.writeFailure = outcome.failure;
    this.refusedAct = "stop";
    return false;
  }

  /**
   * Every channel at once: the banner, the live region and — where `aloud` — the tone and the voice.
   * The first two always; the second two only the first time this page announces a recording.
   */
  #announce(
    occasion: MeetingRecordingOccasion,
    announcement: MeetingRecordingAnnouncement | null,
    aloud: boolean,
  ): void {
    this.notice = recordingNotice(occasion, announcement);
    const words = occasion === "stopped" ? RECORDING_STOPPED : RECORDING_IN_PROGRESS;
    // Emptied now and written after the wait, so the region changes twice and the second change is
    // read; a transition arriving inside the wait replaces the one still waiting.
    this.#cancelRewrite?.();
    this.announcement = "";
    this.#cancelRewrite = this.#after(ANNOUNCEMENT_REWRITE_MILLISECONDS, () => {
      this.#cancelRewrite = null;
      this.announcement = words;
    });
    if (!aloud) return;
    this.#sounds.chime(occasion === "stopped" ? "stopped" : "started");
    this.#sounds.speak(words);
  }
}
