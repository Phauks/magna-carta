/*
 * Read again every few seconds while the page is in view, and at once when the reader comes back
 * to it. This is how the reconciliation screens stay current without a Refresh button: several
 * people can tick the same period, and each sees the others' ticks within a few seconds.
 */

/** How often an open reconciliation screen reads again. */
export const LIVE_READ_MILLISECONDS = 5_000;

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
