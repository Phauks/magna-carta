/*
 * WHAT THIS PERSON IS CALLED IN THE MEETING, as they asked for it.
 *
 * A rename is a `rename` frame, held by the room on this person's participant record for the life of
 * the room: the meeting's own record keeps the account's name, and every roster row carries the
 * original beside a chosen one (`accountName`). This module is the browser's half: the frame, and
 * the one re-send a rename may need.
 *
 * WHY A RE-SEND. The room paces a rename on the same window as a hand and a reaction and REFUSES one
 * inside it, because a rename is a single act nothing later restates. A refusal does not say which
 * frame it was about, so the truth this module settles by is the roster: once the window has passed,
 * a roster row that still does not show the asked-for name means the frame did not land, and it goes
 * again. Three tries, then it stops, so a room that will not take it is not asked forever.
 */
import {
  MAX_MEETING_DISPLAY_NAME_LENGTH,
  SIGNAL_INTERVAL_MILLISECONDS,
} from "@magna-carta/meeting-protocol/frames";

export { MAX_MEETING_DISPLAY_NAME_LENGTH };

/** How many times one rename is sent before this browser stops asking. */
const ATTEMPTS = 3;

/** The browser's edges, so a test runs the re-send without a clock. */
export interface MeetingNamingSeams {
  send: (frame: Record<string, unknown>) => void;
  /** This person's own roster row as this browser last read it, or null before the welcome. */
  ownRow: () => { readonly displayName: string; readonly accountName: string | null } | null;
  /** Wait, then run. Answers with the way to call it off. */
  after: (milliseconds: number, run: () => void) => () => void;
}

export function browserNamingSeams(
  send: MeetingNamingSeams["send"],
  ownRow: MeetingNamingSeams["ownRow"],
): MeetingNamingSeams {
  return {
    send,
    ownRow,
    after: (milliseconds, run) => {
      const waiting = setTimeout(run, milliseconds);
      return () => clearTimeout(waiting);
    },
  };
}

/**
 * The name as it will be sent: spaces at either end taken off and runs of space made one, or null
 * where nothing is left, which the form reads as "nothing to save".
 */
export function cleanDisplayName(typed: string): string | null {
  const cleaned = typed.replaceAll(/\s+/gu, " ").trim();
  if (cleaned === "") return null;
  return cleaned.slice(0, MAX_MEETING_DISPLAY_NAME_LENGTH);
}

export class MeetingNaming {
  readonly #seams: MeetingNamingSeams;
  /** The name last asked for (null: the original), until the roster shows it. */
  #wanted: { readonly name: string | null } | null = null;
  #attempts = 0;
  #cancel: (() => void) | null = null;

  constructor(seams: MeetingNamingSeams) {
    this.#seams = seams;
  }

  /** Go by `name` in this meeting, or by the name this person came in with (`null`). */
  rename(name: string | null): void {
    this.#wanted = { name };
    this.#attempts = 0;
    this.#send();
  }

  /** Whether the roster now shows what was asked for. */
  #landed(): boolean {
    const wanted = this.#wanted;
    if (wanted === null) return true;
    const row = this.#seams.ownRow();
    if (row === null) return false;
    if (wanted.name === null) return row.accountName === null;
    return row.displayName === wanted.name;
  }

  #send(): void {
    const wanted = this.#wanted;
    if (wanted === null) return;
    this.#cancel?.();
    this.#attempts += 1;
    this.#seams.send({ type: "rename", displayName: wanted.name });
    this.#cancel = this.#seams.after(SIGNAL_INTERVAL_MILLISECONDS + 250, () => {
      this.#cancel = null;
      if (this.#landed()) {
        this.#wanted = null;
        return;
      }
      if (this.#attempts < ATTEMPTS) this.#send();
      else this.#wanted = null;
    });
  }

  /** The meeting is over for this page: nothing more is sent. */
  clear(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.#wanted = null;
  }
}
