/*
 * The number a record will take, read before the record exists.
 *
 * WHY THIS IS SHARED. The owner's ruling of 2026-09-08 was written generally — where a record
 * carries a reference number a person reads back, the panel states the number the next one would
 * draw while it is still being filled in, and says that it is a preview rather than a reservation —
 * and it reached one file. The call log had the effect, the wording, the racing-reads guard and the
 * reset, hand-written; every other panel that mints a number showed nothing. That is not a
 * coincidence of effort: the second panel to want this would have had to copy all four, and the
 * first thing to drift would have been the wording.
 *
 * WHAT IS SHARED AND WHAT IS NOT. Each domain keeps its own endpoint and its own scope key — a
 * call's number is scoped to the UTC day it happened on, a matter's to the firm's numbering scheme,
 * a packet's to the custody register — and folding those into one route would put every domain's
 * numbering rules in one handler. What is shared is the shape of the answer, the guard against a
 * stale read landing after a newer one, and the words the reader is told, which are exactly the
 * parts that were drifting.
 *
 * IT KNOWS NOTHING ABOUT HOW THE ANSWER IS FETCHED. The reader hands back a number or null, so the
 * app's own transport, its failure model and its outcome type stay in the app — the same division
 * ./record-reference.css keeps from the app's screens and ../action-dialog's `notice` slot keeps
 * from the app's problem model. A design-system module that imported the app's request layer to
 * save a caller four lines would be the seam this package exists to hold.
 *
 * NOTHING IS RESERVED BY ASKING. A record saved first takes the number and this one moves on, which
 * is why the reference comes back at `preview` standing and why the line renders it beside the words
 * that say so. The record's own number is always read back from the record.
 */
import type { RecordReference } from "./types.ts";

/**
 * Reads what the next number would be, for whatever scope the caller's domain draws within, and
 * answers null where there is no number to show — a refused read, an unserved endpoint, a domain
 * that does not number this kind of record yet.
 */
export type NextNumberReader = () => Promise<string | null>;

/**
 * The previewed number for one panel, held across the openings and the scope changes of its life.
 *
 * A class rather than a function because the answer arrives late and the question can be asked
 * again before it does: a member writing up Tuesday's call on Thursday changes the date, and the
 * read for Tuesday must not be overwritten by an earlier read for Thursday landing after it. Each
 * ask takes a ticket and only the newest ticket may write, which is the same arbitration the call
 * log did by checking whether a record had appeared — a check that was right for that panel and
 * wrong for a panel whose scope can change without one.
 */
export class PreviewedNumber {
  #kind: string;
  #number = $state<string | null>(null);
  #asked = 0;

  /** `kind` is the record kind as a reader says it: "Call", "Matter", "Packet". */
  constructor(kind: string) {
    this.#kind = kind;
  }

  /**
   * The reference to hand a panel's subtitle. Always a `preview`, and null-numbered until an answer
   * lands — which the line states as "A number is drawn when this is saved." rather than as
   * silence, because a blank where a number goes reads as a number that failed to load.
   */
  get reference(): RecordReference {
    return { kind: this.#kind, number: this.#number, standing: "preview" };
  }

  /**
   * Ask again, because the panel opened or its scope changed.
   *
   * A read that answers null leaves the panel usable rather than raising a failure of its own: this
   * is a courtesy the panel offers, and a panel that could not preview a number can still record the
   * record. The honest sentence about a number arriving on save is already what null renders.
   */
  async read(reader: NextNumberReader): Promise<void> {
    const ticket = ++this.#asked;
    this.#number = null;
    const answered = await reader();
    if (ticket !== this.#asked) return;
    this.#number = answered;
  }

  /** Forget the answer — where a panel has saved its record and the record's own number takes over. */
  clear(): void {
    this.#asked += 1;
    this.#number = null;
  }
}
