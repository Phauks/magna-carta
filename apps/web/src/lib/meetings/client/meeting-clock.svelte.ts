/*
 * The clock the subscription policy reads.
 *
 * WHY A ROOM NEEDS ONE OF ITS OWN. `subscriptionPolicy` ages somebody out of the recent-speakers
 * band five minutes after they last said anything, and it takes `now` as a fact handed to it. Read
 * straight off the system clock at the moment the plan is worked out, that window only ever closes
 * when something ELSE in the room makes the plan be worked out again — and in a room that has gone
 * quiet nothing does. The last person to speak then holds the front of the gallery and keeps their
 * microphone pulled for the rest of the meeting, because the one thing that would have moved them
 * is the passing of time and nothing was reading it.
 *
 * So the passing of time is STATE here, moved on by a tick, and the plan re-derives from it exactly
 * as it re-derives from a roster frame. The tick is coarse on purpose: the window it decays is five
 * minutes, so a quarter-minute of lag at its edge is invisible, and the reconciliation each tick
 * asks for does nothing at all when nothing has aged.
 */

/** How often a live meeting's reading of the clock is moved on. */
export const CLOCK_TICK_MILLISECONDS = 15_000;

export class MeetingClock {
  /**
   * Now, as everything in the room that ages reads it. Moved on by the tick and by nothing else, so
   * two answers worked out in the same tick agree about what time it is.
   */
  now = $state(Date.now());

  #ticking: ReturnType<typeof setInterval> | undefined;

  /**
   * Start ticking, and say what each tick should ask for. Starting a running clock restarts it, so
   * a client joining a second meeting does not end up with two.
   */
  start(onTick: () => void): void {
    this.stop();
    this.now = Date.now();
    this.#ticking = setInterval(() => {
      this.now = Date.now();
      onTick();
    }, CLOCK_TICK_MILLISECONDS);
  }

  /**
   * Stop. A torn-down meeting whose clock kept ticking would keep asking a closed socket for the
   * tracks a plan about a room nobody is in still wanted.
   */
  stop(): void {
    if (this.#ticking !== undefined) clearInterval(this.#ticking);
    this.#ticking = undefined;
  }
}
