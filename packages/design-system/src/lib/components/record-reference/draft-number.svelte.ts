/*
 * The draft number a record takes, held for the panel creating it.
 *
 * WHY THIS IS SHARED. Every panel that creates a numbered record states the number it will be saved
 * under while it is still being filled in (the owner's ruling of 2026-11-14: "whenever something is
 * being created, show the draft number, and if it is not saved, then rescind the number"). Each one
 * needs the same four things — ask for a number when it opens, ask again when its scope changes (a
 * call's date), keep the hold alive while it stays open, and give the number back when it is
 * cancelled — and the first of them to drift would have been the one that leaves a gap in a run.
 *
 * WHAT IS SHARED AND WHAT IS NOT. Holding is the server's (`POST /api/v1/number-reservations`); the
 * app hands this class a keeper that speaks to it, so the transport, its failure model and its
 * outcome type stay in the app. What is shared is the lifecycle, the guard against a stale answer
 * landing after a newer one, and the reference the subtitle line renders.
 *
 * NOTHING IS LOST BY A CRASH. A panel closed by a lost tab never gives its number back; the server
 * lets the hold lapse and the next record in the scope takes it, so the run keeps no gap either way.
 */
import type { RecordReference } from "./types.ts";

/** What a panel's keeper hands back: the hold and its number, or null where nothing can be held. */
export interface HeldDraftNumber {
  readonly token: string;
  readonly number: string;
}

/** The app's way of holding and giving back a draft number, for one kind of record. */
export interface DraftNumberKeeper {
  /** Hold a number, or keep the one `token` names; null where nothing can be held yet. */
  hold(token: string | null): Promise<HeldDraftNumber | null>;
  /** Give a held number back. */
  release(token: string): Promise<void>;
}

/** How often an open panel renews its hold. The server lets an unrenewed hold lapse at fifteen. */
export const DRAFT_NUMBER_RENEWAL_MILLISECONDS = 5 * 60_000;

/**
 * The draft number for one panel, held across the openings and the scope changes of its life.
 *
 * A class because the answer arrives late and the question can be asked again before it does:
 * somebody writing up Tuesday's call on Thursday changes the date, and the hold for Thursday must not
 * land after the hold for Tuesday. Each ask takes a ticket and only the newest may write; a number a
 * superseded ask was given is handed straight back, so a quick change of mind costs the run nothing.
 */
export class DraftNumber {
  #kind: string;
  #number = $state<string | null>(null);
  #token: string | null = null;
  #asked = 0;
  #keeper: DraftNumberKeeper | null = null;
  #renewal: ReturnType<typeof setInterval> | null = null;

  /**
   * `kind` is the record kind as a reader says it: "Check", "Packet", "Intake". An empty kind shows
   * the number alone, which is how the call log states it (owner, 2026-11-09).
   */
  constructor(kind: string) {
    this.#kind = kind;
  }

  /** The record kind, which a panel may change as the reader changes what is being created. */
  set kind(kind: string) {
    this.#kind = kind;
  }

  /** The reference to hand a panel's subtitle. Always a `draft`, null-numbered until one is held. */
  get reference(): RecordReference {
    return { kind: this.#kind, number: this.#number, standing: "draft" };
  }

  /** The hold the save carries, so the record is saved under exactly the number shown. */
  get token(): string | undefined {
    return this.#token ?? undefined;
  }

  /**
   * Hold a number, because the panel opened or its scope changed. A keeper that cannot hold one
   * leaves the panel usable: the record is still numbered by its save, and the line names the kind.
   */
  async hold(keeper: DraftNumberKeeper): Promise<void> {
    const ticket = ++this.#asked;
    this.#keeper = keeper;
    const answered = await keeper.hold(this.#token).catch(() => null);
    if (ticket !== this.#asked) {
      // Superseded while it was out. A fresh hold it was given is nobody's: give it straight back.
      if (answered !== null && answered.token !== this.#token) void keeper.release(answered.token);
      return;
    }
    this.#token = answered?.token ?? null;
    this.#number = answered?.number ?? null;
    this.#renew();
  }

  /** Give the number back, because the panel was cancelled. */
  release(): void {
    const token = this.#token;
    const keeper = this.#keeper;
    this.#forget();
    if (token !== null && keeper !== null) void keeper.release(token).catch(() => undefined);
  }

  /** The record was saved and took the number: forget it without giving it back. */
  taken(): void {
    this.#forget();
  }

  #forget(): void {
    this.#asked += 1;
    this.#token = null;
    this.#number = null;
    this.#keeper = null;
    if (this.#renewal !== null) clearInterval(this.#renewal);
    this.#renewal = null;
  }

  #renew(): void {
    if (this.#renewal !== null) return;
    if (this.#token === null) return;
    this.#renewal = setInterval(() => {
      const keeper = this.#keeper;
      if (keeper !== null && this.#token !== null) void this.hold(keeper);
    }, DRAFT_NUMBER_RENEWAL_MILLISECONDS);
  }
}
