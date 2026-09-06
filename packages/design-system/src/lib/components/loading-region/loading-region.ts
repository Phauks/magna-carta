/*
 * The pure half of LoadingRegion: the stall threshold, the settle event, and the two sentences the
 * region derives from a caller's label. Kept out of the component so the app shell can listen for
 * the event by name and a unit test can pin the wording without a browser.
 */

/**
 * How long a read may stay in flight before the region says so on the screen. Fifteen seconds is
 * past any read the product makes on purpose and short of the point where a member gives up and
 * reloads; a stall is stated, never hidden behind a pulse that looks like progress.
 */
export const STALLED_AFTER_MILLISECONDS = 15_000;

/** The bubbling DOM event a region dispatches when a read settles, carrying how long it took. */
export const SETTLED_EVENT = "mc-loading-settled";

export interface LoadingSettledDetail {
  /** The region's sentence — a shape, never a value, so it is safe to record. */
  readonly label: string;
  readonly milliseconds: number;
  /** True when the read settled by failing rather than landing. */
  readonly failed: boolean;
}

/** "Reading the names on this record" → "reading the names on this record". */
function lowered(label: string): string {
  return label.length === 0 ? label : label[0]?.toLowerCase() + label.slice(1);
}

/** What the status line says once the content lands. */
export function finishedSentence(label: string): string {
  return `Finished ${lowered(label)}.`;
}

/** What the screen says when a read has stayed in flight past the threshold. */
export function stalledSentence(label: string): string {
  return `Still ${lowered(label)}. This is taking longer than it should.`;
}
