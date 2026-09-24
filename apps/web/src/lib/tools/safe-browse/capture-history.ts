/*
 * The Safe Website Viewer's capture history — the client-side back/forward stack behind the
 * shell's navigation controls. Pure and DOM-free so the stepping rules are unit-testable
 * (apps/web/test/capture-history.test.ts); the page holds the state and calls these.
 *
 * Every successful capture pushes an entry holding the completed view, so stepping back and
 * forward re-shows stored views instantly with no re-fetch. Pushing after stepping back drops the
 * forward entries, exactly as a browser's history does; a refresh replaces the current entry in
 * place so the stack does not grow with re-captures of one address. Every function returns a new
 * history rather than mutating, so reactive state can hold the result directly.
 *
 * Generic over the view so the stack knows nothing about what a capture contains — the page
 * instantiates it with the capture module's view type.
 */

export interface CaptureEntry<View> {
  /** The normalized address the capture was asked for. */
  enteredUrl: string;
  /** The completed capture for that address. */
  view: View;
  /** When the capture completed, epoch milliseconds. */
  capturedAt: number;
  /** How long the capture took, milliseconds measured around the request. */
  elapsedMs: number;
  /**
   * Which browser produced it. Recorded on the entry rather than read from the toggle, because a
   * member can capture in one mode, switch, then step back to the older capture — and a held Live
   * browser and a fresh Static one can see the same address differently.
   */
  mode: "static" | "live";
}

export interface CaptureHistory<View> {
  entries: readonly CaptureEntry<View>[];
  /** The position of the entry on show; -1 while nothing has been captured. */
  index: number;
}

/** A history with nothing captured yet. */
export function emptyHistory<View>(): CaptureHistory<View> {
  return { entries: [], index: -1 };
}

/**
 * Record a completed capture as the new current entry. Any entries ahead of the current position
 * (reachable only by going forward) are dropped, because capturing from a past position starts a
 * new branch of the walk.
 */
export function pushCapture<View>(
  history: CaptureHistory<View>,
  entry: CaptureEntry<View>,
): CaptureHistory<View> {
  const entries = [...history.entries.slice(0, history.index + 1), entry];
  return { entries, index: entries.length - 1 };
}

/**
 * Replace the current entry with a fresh capture of the same position — what a refresh records.
 * On an empty history it behaves as a push, so the caller never has to branch.
 */
export function replaceCurrent<View>(
  history: CaptureHistory<View>,
  entry: CaptureEntry<View>,
): CaptureHistory<View> {
  if (history.index === -1) return pushCapture(history, entry);
  const entries = [...history.entries];
  entries[history.index] = entry;
  return { entries, index: history.index };
}

export function canGoBack<View>(history: CaptureHistory<View>): boolean {
  return history.index > 0;
}

export function canGoForward<View>(history: CaptureHistory<View>): boolean {
  return history.index !== -1 && history.index < history.entries.length - 1;
}

/** Step to the previous entry; a history that cannot go back is returned unchanged. */
export function back<View>(history: CaptureHistory<View>): CaptureHistory<View> {
  if (!canGoBack(history)) return history;
  return { entries: history.entries, index: history.index - 1 };
}

/** Step to the next entry; a history that cannot go forward is returned unchanged. */
export function forward<View>(history: CaptureHistory<View>): CaptureHistory<View> {
  if (!canGoForward(history)) return history;
  return { entries: history.entries, index: history.index + 1 };
}

/** The entry on show, or null while nothing has been captured. */
export function currentEntry<View>(history: CaptureHistory<View>): CaptureEntry<View> | null {
  return history.index === -1 ? null : (history.entries[history.index] ?? null);
}
