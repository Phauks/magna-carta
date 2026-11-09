/*
 * The arithmetic behind a record that reads as one scrolling document: which section the reader is
 * standing in, and how much of a long list stands before the rest is asked for.
 *
 * A directory record — being entered on the New Person screen, or read back in the entity window —
 * is every one of its sections stacked on one page, with the side rail jumping between them. The
 * rail has to say where the reader is, and it has to say it from the scroll position alone, because
 * scrolling is the gesture most people use. Kept as pure functions so the rule can be asserted
 * without a browser laying anything out.
 */

/** One section of the record: what the rail calls it, and how many it holds where it is a list. */
export interface RecordSection {
  /** Stable identity; the rail's key and the anchor the section is found by. */
  readonly id: string;
  readonly label: string;
  /** How many it holds, where the rail can say so; `null` or absent draws no number. */
  readonly count?: number | null;
}

/** Where one section starts, measured from the top of the scrolling region's content. */
export interface SectionOffset {
  readonly id: string;
  readonly top: number;
}

/**
 * How far below the top edge a section's start may sit and still be the one being read. A heading
 * that has just come into view under the edge is where the reader's eye already is.
 */
export const SECTION_READING_LINE = 32;

/**
 * The section the reader is standing in: the last one whose start has passed the reading line.
 *
 * Two edges need saying. Before anything has scrolled, the first section is current even if the
 * region opens with padding above it. And once the region cannot scroll any further, the LAST
 * section is current: a short final section never reaches the top edge, so without this its rail
 * row could never light by scrolling, only by a press.
 */
export function sectionAt(
  offsets: readonly SectionOffset[],
  scroll: { readonly top: number; readonly viewport: number; readonly content: number },
): string | null {
  const first = offsets[0];
  if (first === undefined) return null;
  const atEnd = scroll.top + scroll.viewport >= scroll.content - 1;
  if (atEnd && scroll.top > 0) return offsets[offsets.length - 1]?.id ?? first.id;
  let current = first.id;
  for (const offset of offsets) {
    if (offset.top <= scroll.top + SECTION_READING_LINE) current = offset.id;
  }
  return current;
}

/**
 * How many rows of a long list stand before "Show All". Enough to answer the usual question — the
 * current matters, the main relationships — without one list pushing every section after it off
 * the page.
 */
export const COLLAPSED_ROW_LIMIT = 5;

/** The rows a list shows: all of them once opened, otherwise the first few. */
export function visibleRows<Row>(
  rows: readonly Row[],
  expanded: boolean,
  limit: number = COLLAPSED_ROW_LIMIT,
): readonly Row[] {
  return expanded || rows.length <= limit ? rows : rows.slice(0, limit);
}

/** How many rows the collapsed list is holding back; zero when nothing is. */
export function heldBackRows(
  rows: readonly unknown[],
  expanded: boolean,
  limit: number = COLLAPSED_ROW_LIMIT,
): number {
  return expanded ? 0 : Math.max(0, rows.length - limit);
}
