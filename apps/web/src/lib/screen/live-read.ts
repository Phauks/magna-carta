/*
 * Read again on a timer while the page is in view, and at once when the reader comes back to it.
 * This is how a screen stays current without a Refresh button. The reconciliation screens use the
 * short default: several people can tick the same period, and each sees the others' ticks within
 * a few seconds. The calendar uses a longer one, for a change that arrived from somebody else or
 * from a member's own Outlook or Google calendar.
 */

/** How often an open reconciliation screen reads again. */
export const LIVE_READ_MILLISECONDS = 5_000;

/**
 * How often an open calendar reads again. A change made in Outlook or Google reaches the firm's
 * calendar within seconds, and the reader mostly meets it by coming back to this tab, which reads
 * at once. The timer is for a calendar left in view, and a window's read is many requests, so it
 * is slower than the reconciliation screens'.
 */
export const CALENDAR_LIVE_READ_MILLISECONDS = 30_000;

/** Start reading again on a timer. Returns the stop function, for an effect's teardown. */
export function readLive(read: () => void, every = LIVE_READ_MILLISECONDS): () => void {
  if (typeof window === "undefined") return () => {};
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") read();
  }, every);
  const onReturn = (): void => {
    if (document.visibilityState === "visible") read();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}
