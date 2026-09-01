/*
 * Whether the trouble is this panel or the whole platform.
 *
 * THE CASE THIS EXISTS FOR: several reads fail at once and the member sees six differently-worded
 * local failures on one screen, none of which says the true thing. One line above the shell says it
 * once, and the panels underneath stop apologising individually.
 *
 * IT INFERS FROM WHAT THE APP ALREADY KNOWS. There is no health signal being consulted — every
 * failing call passes through the one transport seam, and that is enough to tell the two shapes
 * apart:
 *
 *   SKEW — a 404 answered by no route at all. One is conclusive: the app only ever calls paths it
 *   was built against, so a path the service does not recognise means the interface and the API are
 *   on different releases. They deploy as separate Workers, so a fresh page can meet an older API
 *   for a few minutes after a release.
 *
 *   FAULT — server faults and calls nothing answered. One of those is one failing read and says
 *   nothing about the platform; several inside a short window is a pattern, and the threshold is
 *   what stops a single 503 from announcing an outage.
 *
 * Signals expire, so a notice never outlives the trouble: a member who has been working happily for
 * five minutes is not told the platform is unwell because something failed once when they arrived.
 */
import type { Failure } from "$lib/api/problem.ts";
import { isServiceSkew } from "./guidance.ts";

/** How long a signal counts for. Long enough to gather a pattern, short enough to clear itself. */
const SIGNAL_LIFETIME_MILLISECONDS = 90_000;

/** How many faults inside the window before it is the platform rather than one unlucky read. */
const FAULT_THRESHOLD = 3;

export type PlatformTrouble = "skew" | "fault";

class PlatformHealth {
  /** When each fault was seen. Skew is tracked separately because one of it is conclusive. */
  #faultsAt = $state<number[]>([]);
  #skewAt = $state<number | null>(null);

  /**
   * Record what a failure says about the platform. Called from the transport seam, so coverage is
   * total and no surface has to remember to opt in — the alternative is the arrangement that left
   * most surfaces without an Error ID.
   */
  note(failure: Failure): void {
    const now = Date.now();
    if (failure.problem !== null && isServiceSkew(failure.problem)) {
      this.#skewAt = now;
      return;
    }
    // A refusal is about the request, not the platform: a 403 is the access control working.
    const isFault = failure.problem === null || failure.problem.status >= 500;
    if (!isFault) return;
    this.#faultsAt = [...this.#faultsAt.filter(this.#isLive(now)), now];
  }

  /** Called when a read succeeds, so recovery clears the notice rather than waiting it out. */
  noteSuccess(): void {
    if (this.#skewAt !== null) this.#skewAt = null;
    if (this.#faultsAt.length > 0) this.#faultsAt = [];
  }

  #isLive(now: number): (at: number) => boolean {
    return (at) => now - at < SIGNAL_LIFETIME_MILLISECONDS;
  }

  /** What the platform looks like right now, or null when nothing suggests trouble. */
  get trouble(): PlatformTrouble | null {
    const now = Date.now();
    if (this.#skewAt !== null && now - this.#skewAt < SIGNAL_LIFETIME_MILLISECONDS) return "skew";
    return this.#faultsAt.filter(this.#isLive(now)).length >= FAULT_THRESHOLD ? "fault" : null;
  }

  /** Drop everything. For tests, and for a sign-out that should not carry state into the next session. */
  reset(): void {
    this.#faultsAt = [];
    this.#skewAt = null;
  }
}

/** One per app: the shell reads it, and the transport seam feeds it. */
export const platformHealth = new PlatformHealth();
