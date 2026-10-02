/*
 * WHICH COLLEAGUE-DAYS HAVE BEEN ASKED ABOUT, AND WHAT CAME BACK.
 *
 * The availability line is one read per colleague, for one day, and only while the form is open —
 * so the whole of its behaviour is bookkeeping over three facts that are deliberately kept apart:
 * which pairs have been ASKED about, which have been ANSWERED, and whether the form asking is still
 * open. It lives here rather than in the component because it is a decision, and a decision found
 * in a `.svelte` file is one no case can reach without a browser.
 *
 * "ASKED" AND "ANSWERED" ARE NOT THE SAME FACT. A colleague whose read is still in flight must not
 * read as free, which is why nothing is recorded until a read comes BACK, and why the set of pairs
 * already asked about is separate and is not reactive: it exists to stop a second request, not to
 * paint anything.
 *
 * A READ THAT FAILED IS NOT AN ANSWER. It used to leave its pair marked as asked, which meant the
 * one thing that could never happen again was asking — the line stayed blank for the rest of the
 * form's life with nothing on the screen saying why. A failure now un-marks the pair, so the next
 * pass over the form asks again.
 *
 * NOTHING SURVIVES THE FORM CLOSING. Availability is a claim about a particular hour of a
 * particular day, and a form reopened later is a fresh question: the day may have filled up, the
 * read that failed may now succeed, and a cached "Free" from an hour ago is the one answer that
 * would be believed without being checked.
 */

import { LatestOnly } from "$lib/api/latest-only.ts";
import type { CalendarEntry } from "./calendar-entries.ts";

/** One colleague on the draft, as the member participants state them. */
export interface AvailabilityColleague {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * One colleague's day, read. Null where the read did not come back — which is a different outcome
 * from an empty day, and is the one that gets asked again.
 */
export type AvailabilityDayReader = (
  userId: string,
  date: string,
) => Promise<readonly CalendarEntry[] | null>;

/** The key one colleague's day is held under: per member and per day, so neither is re-asked. */
function keyOf(userId: string, date: string): string {
  return `${userId}@${date}`;
}

export class AvailabilityReads {
  /** What came back, keyed by colleague and day. Filled only when a read ANSWERS. */
  #entriesByKey = $state<Record<string, readonly CalendarEntry[]>>({});

  /** Which pairs a read has gone out for. Not reactive: it stops a second request, it paints nothing. */
  readonly #asked = new Set<string>();

  /** Whether anything has answered, so closing an untouched form writes nothing. */
  #answered = false;

  /**
   * The stale-answer guard, the product's one shape of it. A read still in flight when the form
   * closes belongs to the round that asked for it, and a form reopened in the meantime must not be
   * filled in with what the last one asked.
   */
  readonly #latest = new LatestOnly();

  /** One colleague's day, where it has been read. Undefined means nobody has answered yet. */
  entriesFor(userId: string, date: string): readonly CalendarEntry[] | undefined {
    return this.#entriesByKey[keyOf(userId, date)];
  }

  /**
   * Ask about whatever is not in hand — and forget everything once the form is shut.
   *
   * Adding a person asks about that person; moving the date asks again about everybody; neither
   * re-asks about a pair already answered.
   */
  refresh(
    open: boolean,
    colleagues: readonly AvailabilityColleague[],
    date: string | null,
    read: AvailabilityDayReader,
  ): void {
    if (!open) {
      this.forgetEverything();
      return;
    }
    if (date === null) return;
    for (const colleague of colleagues) {
      const key = keyOf(colleague.userId, date);
      if (this.#asked.has(key)) continue;
      this.#asked.add(key);
      void this.#issue(key, colleague.userId, date, read);
    }
  }

  /** The form closed. Nothing about an hour on a day survives it — the module note says why. */
  forgetEverything(): void {
    if (this.#asked.size === 0 && !this.#answered) return;
    // Everything in flight is declared stale without a read replacing it: the form is shut, and a
    // read that was running when it shut must not fill in the next one.
    this.#latest.supersede();
    this.#asked.clear();
    this.#answered = false;
    this.#entriesByKey = {};
  }

  async #issue(
    key: string,
    userId: string,
    date: string,
    read: AvailabilityDayReader,
  ): Promise<void> {
    // `attempt`, not `begin`: the reads of one round run side by side, one per colleague, and each
    // answers about a different person — so a second one starting must not supersede the first.
    const attempt = this.#latest.attempt();
    const entries = await read(userId, date);
    // The form closed while this was in flight, and what it asked belongs to the round that asked.
    if (!attempt.current) return;
    if (entries === null) {
      // A read that failed leaves the line blank rather than claiming the colleague is free, and
      // un-marks the pair so the next pass asks again. The form is not blocked on it either way:
      // this is an answer to a question, not a gate.
      this.#asked.delete(key);
      return;
    }
    this.#answered = true;
    this.#entriesByKey = { ...this.#entriesByKey, [key]: entries };
  }
}
