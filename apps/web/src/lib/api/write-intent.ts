// The double-submit guard, and why an in-flight flag is not the whole of one.
//
// Every mutation carries an Idempotency-Key, and the server collapses a repeat of the SAME key onto
// the first one's stored response. That is what makes a retry safe. It does nothing about a second
// click, because a second click calls `writeKey()` again and a fresh key is, by construction, a
// different request — so the platform's whole idempotency machinery politely records two fees.
//
// The key has to be minted per INTENT rather than per call: one key for "record this cost", reused by
// every attempt at it, rotated only once an attempt has actually succeeded. Then a double click, a
// retry after a timeout, and a retry after an offline stretch all collapse into one effect server-side
// — using the mechanism that is already there rather than a second one that races it.
//
// A disabled control is still worth having and is not a substitute. It stops the second click in the
// common case and does nothing for the case that produces the duplicate: the click that lands in the
// same tick, before any state has been written back; a keyboard repeat; a form submitted by Enter
// while the button is already busy. Those arrive before the flag they would have read.

/** What a submission returned, and whether this call performed it or joined one already running. */
export interface WriteOutcome<T> {
  readonly value: T;
  /** True when a submission was already in flight and this call joined it rather than starting a second. */
  readonly joined: boolean;
}

/**
 * One user intent's write: a stable idempotency key, and at most one submission in flight.
 *
 * ```ts
 * const intent = new WriteIntent();
 * // every attempt at THIS cost, however many times the button is pressed:
 * await intent.submit((key) => captureCost(fetch, draft, key));
 * ```
 *
 * The key is stable until a submission succeeds, so a retry is a retry as far as the server is
 * concerned. After a success the intent rotates, so the next thing the person records is a new one.
 */
export class WriteIntent {
  #key: string = crypto.randomUUID();
  #inFlight: Promise<unknown> | null = null;

  /** The key this intent's attempts carry. Stable across retries; rotates after a success. */
  get key(): string {
    return this.#key;
  }

  /**
   * Run `write` with this intent's key, joining a submission already in flight rather than starting
   * a second.
   *
   * A FAILED attempt keeps the key. That is the point: the next attempt is the same request, so if
   * the failure was a timeout on a write the server actually committed, the retry replays that
   * commit instead of making a second one. Only a success rotates.
   */
  async submit<T>(write: (key: string) => Promise<T>): Promise<WriteOutcome<T>> {
    const running = this.#inFlight;
    if (running !== null) return { value: (await running) as T, joined: true };

    const attempt = write(this.#key);
    this.#inFlight = attempt;
    try {
      const value = await attempt;
      this.#key = crypto.randomUUID();
      return { value, joined: false };
    } finally {
      this.#inFlight = null;
    }
  }
}
