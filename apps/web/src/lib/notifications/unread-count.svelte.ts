/*
 * THE BADGE, OWNED ONCE. The bell in the top bar and the notification centre both need to know how
 * many notifications are waiting, and they must never disagree: a bell reading three over a list
 * showing none is the kind of small dishonesty that costs a surface its credibility permanently.
 * So the count lives here, one per application, and both surfaces read it.
 *
 * IT IS POLLED, NOT PUSHED, AND THAT IS THE DESIGN TODAY. There is no per-member push channel, so
 * the count is re-read on a slow interval and again whenever the window regains focus — which is
 * the moment a member actually looks. The interval is generous on purpose: the read is index-covered
 * and cheap, but a badge is not worth a request every few seconds, and the focus refetch is what
 * makes it feel current rather than the timer.
 *
 * THE POLL STOPS WHEN THE PAGE IS HIDDEN. A background tab polling forever is a request the member
 * gets no value from, and a laptop that never sleeps.
 *
 * A FAILED READ NEVER CLEARS THE BADGE. Whatever was last known stays on screen: replacing a real
 * count with a zero because one request failed tells the member they are caught up when they are
 * not, which is the one error this surface must not make. The failure is still reported through the
 * transport seam, so the platform notice sees it like any other.
 */
import { readUnreadNotificationCount, type NotificationUnreadCount } from "./notifications-api.ts";

/** How often the count is re-read while the page is visible. */
const POLL_INTERVAL_MILLISECONDS = 120_000;

/**
 * Above this the badge reads "99+". A four-digit badge is a badge that changes the top bar's
 * geometry, and past a hundred the exact number has stopped being information anyway.
 */
const BADGE_CEILING = 99;

class UnreadNotificationCount {
  #counts = $state<NotificationUnreadCount | null>(null);
  /** True until the first read lands, so the bell can stay quiet rather than flash a zero. */
  #settled = $state(false);
  #inFlight = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  /** How many surfaces are currently watching; the poll runs while at least one is. */
  #watchers = 0;
  /** The focus/visibility handler while watching, held so the same reference can be removed. */
  #onFocus: (() => void) | null = null;

  /** What is waiting. Null until the first read lands. */
  get counts(): NotificationUnreadCount | null {
    return this.#counts;
  }

  get settled(): boolean {
    return this.#settled;
  }

  /** The number itself, and zero before the first read so nothing renders a badge prematurely. */
  get unread(): number {
    return this.#counts?.unreadCount ?? 0;
  }

  /** What the retention sweep took while it was still unread — reported apart, never added in. */
  get sweptUnread(): number {
    return this.#counts?.sweptUnreadCount ?? 0;
  }

  /** The badge's text, or null when there is nothing to show. */
  get badge(): string | null {
    if (this.unread === 0) return null;
    return this.unread > BADGE_CEILING ? `${String(BADGE_CEILING)}+` : String(this.unread);
  }

  /** Re-read now. Overlapping calls collapse into the one in flight. */
  async refresh(fetchImpl: typeof fetch = fetch): Promise<void> {
    if (this.#inFlight) return;
    this.#inFlight = true;
    const outcome = await readUnreadNotificationCount(fetchImpl);
    this.#inFlight = false;
    // A refusal leaves the last known count standing, deliberately. See the header.
    if (outcome.kind !== "ok") {
      this.#settled = true;
      return;
    }
    this.#counts = outcome.value;
    this.#settled = true;
  }

  /**
   * Adopt a count a write already told us, so a mark-read does not wait for the next poll to show
   * up on the bell. Only ever moves the live count: the swept tally is the retention sweep's fact
   * and no client-side write knows anything about it.
   */
  noteUnread(unreadCount: number): void {
    const current = this.#counts;
    this.#counts =
      current === null
        ? { unreadCount, sweptUnreadCount: 0, sweptUnreadOldestOccurredAt: null }
        : { ...current, unreadCount };
    this.#settled = true;
  }

  /** One fewer waiting, after a row the member just settled. Never below zero. */
  noteOneSettled(): void {
    this.noteUnread(Math.max(0, this.unread - 1));
  }

  /**
   * Start watching. Returns the stop function, so a caller wires it straight into an effect's
   * teardown and cannot leak a timer by forgetting which method undoes this one.
   */
  watch(fetchImpl: typeof fetch = fetch): () => void {
    this.#watchers += 1;
    if (this.#watchers === 1) this.#start(fetchImpl);
    void this.refresh(fetchImpl);
    return () => {
      this.#watchers -= 1;
      if (this.#watchers === 0) this.#stop();
    };
  }

  #start(fetchImpl: typeof fetch): void {
    if (typeof window === "undefined") return;
    this.#timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void this.refresh(fetchImpl);
    }, POLL_INTERVAL_MILLISECONDS);
    this.#onFocus = () => {
      if (document.visibilityState === "visible") void this.refresh(fetchImpl);
    };
    window.addEventListener("focus", this.#onFocus);
    document.addEventListener("visibilitychange", this.#onFocus);
  }

  #stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    if (typeof window !== "undefined" && this.#onFocus !== null) {
      window.removeEventListener("focus", this.#onFocus);
      document.removeEventListener("visibilitychange", this.#onFocus);
    }
    this.#onFocus = null;
  }

  /** Drop everything — for a sign-out that must not carry one member's count into the next session. */
  reset(): void {
    this.#counts = null;
    this.#settled = false;
  }
}

/** One per application: the bell reads it, the centre reads it, and both write back what they settle. */
export const unreadNotificationCount = new UnreadNotificationCount();
