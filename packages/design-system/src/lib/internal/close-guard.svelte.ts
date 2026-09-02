/*
 * The one guard every way out of a modal surface runs through.
 *
 * A modal panel has several exits — a header's close control, Escape, a press outside the panel,
 * and sometimes a verb of the panel's own that abandons a mode. Having ONE function they all run
 * through is the whole point: a second exit that skipped the question would make the question
 * decorative, and a reader would learn that their work is safe on some gestures and not others
 * without ever being told which.
 *
 * The guard is not the question. It decides WHETHER to ask and remembers WHAT the reader was
 * trying to do while the question is on screen; the question itself is a component
 * (./discard-question.svelte), and what happens when the reader says "discard" is the caller's,
 * because only the caller knows whether that means closing a window or leaving a mode.
 *
 * It lives here rather than beside either shell because both shells need it and there is exactly
 * one right answer. It was private to the record window until the modal shell needed it too, at
 * which point a second copy would have been two questions with two wordings that drift apart the
 * first time one is corrected.
 */

/**
 * What a reader was trying to do when the guard stopped them. The names are the shells' own
 * gestures rather than anything domain-shaped: this module never learns what is inside the panel.
 */
export type GuardedGesture = "leaveEditing" | "closeSurface";

/**
 * A guard over one surface's exits.
 *
 * Construct it with a function that answers whether there is anything to lose RIGHT NOW — it is
 * read at the moment of the gesture, never cached, because a panel becomes dirty and clean again
 * while it is open and a guard holding a stale answer asks the wrong question.
 */
export class CloseGuard {
  /** The gesture waiting on the reader to say whether the work may be thrown away. */
  #pending = $state<GuardedGesture | null>(null);
  readonly #hasUnsavedWork: () => boolean;

  constructor(hasUnsavedWork: () => boolean) {
    this.#hasUnsavedWork = hasUnsavedWork;
  }

  /** Whether the question is on screen. */
  get asking(): boolean {
    return this.#pending !== null;
  }

  /** Which gesture is waiting, or null when none is. Read by a shell that renders per-gesture words. */
  get pending(): GuardedGesture | null {
    return this.#pending;
  }

  /**
   * Ask for a gesture. Returns `true` when it may proceed immediately — the caller then does it —
   * and `false` when the question has been raised instead and the caller must do nothing at all.
   *
   * The boolean is deliberately the whole contract. A guard that ran the gesture itself through a
   * callback would need to know how to close a window, leave a mode, and whatever the next shell
   * invents; a guard that answers yes-or-no knows nothing and cannot fall behind.
   */
  request(gesture: GuardedGesture): boolean {
    if (!this.#hasUnsavedWork()) return true;
    this.#pending = gesture;
    return false;
  }

  /**
   * The reader chose to discard. Clears the question and hands back the gesture that was waiting,
   * so the caller can carry it out — or null if nothing was.
   */
  release(): GuardedGesture | null {
    const gesture = this.#pending;
    this.#pending = null;
    return gesture;
  }

  /** The reader chose to keep working. The gesture is abandoned, not deferred. */
  dismiss(): void {
    this.#pending = null;
  }
}
