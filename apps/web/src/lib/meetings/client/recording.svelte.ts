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
 * WHETHER A RECORDING IS NEW IS DECIDED BY THE TRANSITION, NOT BY ITS HANDLE. A guest's copy of the
 * announcement carries `recordingId: null`, because the handle names a firm record and a guest is
 * told a name and never an identifier — and a guest's voice is in the recording, so a guest is owed
 * the tone, the mark and the banner exactly as a member is. So a start is news when nothing was
 * running before it: a `started` after a `stopped`, or a welcome naming a running recording after a
 * socket that had none. Only a welcome after a socket that DID have one asks which recording it is,
 * and answers by the handle where both copies carry one and by the instant it started where they do
 * not: both a start frame and a welcome carry that instant, and no two recordings of one room start
 * at the same one.
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
import { SILENT_RECORDING_SOUNDS, type MeetingRecordingSounds } from "./recording-sounds.ts";
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
 * READ DEFENSIVELY AND WHOLE, like every frame in this directory. The handle may be null — a guest's
 * copy carries none, because it names a firm record — but it may not be missing or anything else,
 * because a frame that dropped a field is not the shape the room sends. The instant is required: it
 * is what tells two recordings apart where there is no handle. The actor is kept even without a
 * member handle — a guest's copy carries `userId: null`, which is the rule every frame naming a firm
 * user follows — and is null only where the room said nobody acted, which is a recording that stopped
 * on its own.
 */
export function readRecordingAnnouncement(value: unknown): MeetingRecordingAnnouncement | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state !== "started" && state !== "stopped") return null;
  const handle = value.recordingId;
  if (handle !== null && typeof handle !== "string") return null;
  const at = readString(value, "at");
  if (at === null) return null;
  const by = isRecord(value.by)
    ? {
        userId: readString(value.by, "userId"),
        displayName: readString(value.by, "displayName") ?? "",
      }
    : null;
  return { state, recordingId: handle, by, at };
}

/**
 * Whether two announcements of a running recording are about the same recording: by the handle where
 * both carry one, and by the instant it started where either does not — a guest's copy.
 */
export function sameRecording(
  one: MeetingRecordingAnnouncement,
  other: MeetingRecordingAnnouncement,
): boolean {
  if (one.recordingId !== null && other.recordingId !== null) {
    return one.recordingId === other.recordingId;
  }
  return one.at === other.at;
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
   * The recording this page has announced ALOUD as running — the tone and the voice — as the room
   * announced it, so a later copy can be asked whether it is the same one (`sameRecording`).
   *
   * Kept across a lost socket and the rejoin that follows, which is what keeps a connection that
   * blinks from chiming every time it comes back: the welcome after it names the same recording,
   * and the banner and the live region say so again, but the tone has already sounded for that one.
   * Forgotten when the recording stops or the member leaves, because either way the next one is news.
   */
  #announcedAloud: MeetingRecordingAnnouncement | null = null;

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
      this.#announce("arrival", announcement, this.#isNews(announcement));
      return;
    }
    this.running = null;
    if (this.#announcedAloud === null) return;
    this.#announcedAloud = null;
    this.#announce("stopped", null, true);
  }

  /**
   * The room broadcast a transition. A repeat of the state already held is not one: a start while a
   * recording runs is news only where it is plainly a different recording.
   */
  noteFrame(announcement: MeetingRecordingAnnouncement | null): void {
    if (announcement === null) return;
    if (announcement.state === "started") {
      if (this.running !== null && sameRecording(this.running, announcement)) return;
      this.running = announcement;
      this.#announce("started", announcement, this.#isNews(announcement));
      return;
    }
    // A stop for a recording nobody here was told about has nothing to take down and nothing to say.
    if (this.running === null && this.#announcedAloud === null) return;
    this.running = null;
    this.#announcedAloud = null;
    this.#announce("stopped", announcement, true);
  }

  /**
   * Whether a running recording is one this page has not yet sounded, and remember it as sounded.
   * News where nothing was sounded before — a start after a stop, or the first socket to hear of it —
   * and where the one sounded was plainly another recording.
   */
  #isNews(announcement: MeetingRecordingAnnouncement): boolean {
    const sounded = this.#announcedAloud;
    this.#announcedAloud = announcement;
    return sounded === null || !sameRecording(sounded, announcement);
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

  /**
   * The meeting is over for this browser: everything goes, and this room gives back its hold on the
   * audio device. The device itself closes only when nothing else holds it, so a press that has
   * already woken it for the next room keeps it.
   */
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
