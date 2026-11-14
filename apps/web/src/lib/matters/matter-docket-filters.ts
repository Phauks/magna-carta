/*
 * What the docket is currently being asked for, and whether that is narrower than the whole thing.
 *
 * THE DOCKET SHOWS EVERY MATTER, AND THE TABLE IS THE ONLY THING THAT NARROWS IT. The screen once
 * carried a second, separate control that chose between the working docket, open matters, closed
 * matters and consultations. It is gone: those are values of the Status column, the table already
 * filters on that column, and two mechanisms answering one question is how a reader ends up staring
 * at an almost-empty table with a narrowing set on a control they are not looking at. The screen
 * reads the whole record and the column filters do the rest.
 *
 * TWO MECHANISMS REMAIN, AND THEY ARE STILL NOT THE SAME KIND OF THING. The SEARCH is the server's,
 * run over the firm's whole record rather than the rows on screen. The COLUMN FILTERS are the
 * table's, run over what has been loaded. What this module owns is the arithmetic of saying so:
 * whether anything is holding matters back from the view, and what to call it.
 */

export interface DocketNarrowing {
  /** The settled search text, not what is mid-keystroke. */
  readonly search: string;
  /** How many of the table's own columns are filtered. */
  readonly columnFilterCount: number;
}

/** Whether anything is holding matters back from the view. */
export function docketIsNarrowed(narrowing: DocketNarrowing): boolean {
  return narrowing.search.trim() !== "" || narrowing.columnFilterCount > 0;
}

/**
 * What the narrowing control says about itself, for its accessible name and its hover.
 *
 * It states what is in play rather than how to undo it: the control is the way to undo it, and a
 * sentence explaining a control that is under the reader's pointer is a sentence read once.
 */
export function docketNarrowingSummary(narrowing: DocketNarrowing): string {
  const parts: string[] = [];
  if (narrowing.search.trim() !== "") parts.push(`searching "${narrowing.search.trim()}"`);
  if (narrowing.columnFilterCount > 0) {
    parts.push(
      narrowing.columnFilterCount === 1
        ? "1 column filtered"
        : `${narrowing.columnFilterCount} columns filtered`,
    );
  }
  return parts.length === 0 ? "All matters" : parts.join(" · ");
}
