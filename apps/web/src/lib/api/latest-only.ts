// The stale-answer guard, and the one shape of it.
//
// A screen that reads on a subject — a matter, a page, a conversation — starts a read, and before it
// answers the person picks something else and a second read starts. Both resolve. Nothing about the
// order they resolve in is under anyone's control: two requests over one connection can come back in
// either order, and the slower one is frequently the FIRST one. Whichever lands last wins the state,
// so the screen shows the previous matter's rows under the current matter's heading, and looks
// exactly like a screen that loaded correctly.
//
// Aborting the older request is not the same thing and does not replace this. An abort is a request
// to stop that may arrive after the response already did, it does nothing for a read that was never a
// single fetch (several calls whose answers depend on each other), and it cannot help a read that had
// already resolved and was waiting its turn on the microtask queue. The guard is what decides whether
// an answer is allowed to be written; aborting is an optimization on top that saves the bytes.
//
// Four screens had grown their own copy of this before it was extracted, each with its own name for
// the counter. They agreed, which is lucky rather than structural — the copy is the kind of thing
// that is written correctly and then edited incorrectly, because the bug it prevents is invisible in
// every test that resolves one read at a time.

/** One read's claim on the state. `current` goes false the moment a newer read supersedes it. */
export interface ReadAttempt {
  /** Whether this read is still the newest — false means its answer must be dropped, not written. */
  readonly current: boolean;
}

/**
 * Tracks which read is the newest, so an older one that resolves late writes nothing.
 *
 * ```ts
 * const attempt = this.latest.begin();
 * const rows = await read();
 * if (!attempt.current) return; // a newer read has started; this answer is history
 * this.rows = rows;
 * ```
 */
export class LatestOnly {
  #generation = 0;

  /**
   * Declare everything in flight stale WITHOUT starting a read.
   *
   * For the reset that happens when the subject changes but the read comes later, or not at all — a
   * cleared screen must not be refilled by the read that was running when it was cleared.
   */
  supersede(): void {
    this.#generation += 1;
  }

  /** Capture the current read's claim without superseding anything — for a read that follows a reset. */
  attempt(): ReadAttempt {
    const generation = this.#generation;
    const self = this;
    return {
      get current() {
        return generation === self.#generation;
      },
    };
  }

  /** Supersede whatever is in flight and claim the state for this read. The common case. */
  begin(): ReadAttempt {
    this.supersede();
    return this.attempt();
  }
}
