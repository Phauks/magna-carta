import { encodeCursor, decodeCursor } from "@magna-carta/data-access/cursor-pagination";
import { CANONICAL_INSTANT_PATTERN } from "./types.ts";
import type { TimelineCursor, TimelineEntry } from "./sources/registry.ts";

// One sort key across heterogeneous sources, compared AS TEXT.
//
// That works because ISO-8601 was designed for it: lexicographic order over canonical ISO-8601
// strings IS chronological order. "2026-08-05" sorts before "2026-08-05T09:00:00.000Z" (a prefix
// sorts first), which sorts before "2026-08-06". A day-granular event therefore lands at the head of
// its own day, ahead of everything timed on that day — which is also the right reading for a person:
// "on the 5th" precedes "at 9am on the 5th".
//
// No conversion, no per-source normalization pass, and no projection of civil dates into instants at
// read time — which would have required knowing each row's zone inside the SQL statement.
//
// THE OBLIGATION THAT MAKES IT TRUE: every instant column must be canonical. Date.prototype
// .toISOString emits exactly YYYY-MM-DDTHH:mm:ss.sssZ — a fixed three-digit fraction, always Z — and
// every clock in the platform is that call. The hazard is real and worth naming: a source that began
// writing "2026-08-05T09:00:00Z" (no fraction) would sort AFTER "2026-08-05T09:00:00.500Z", because
// '.' precedes 'Z' in byte order, and the timeline would be quietly wrong in a way no test of the
// merge itself would catch. assertCanonicalInstant below is what a fitness test runs over every
// registered instant source's real column values.

export function assertCanonicalInstant(value: string, context: string): void {
  if (!CANONICAL_INSTANT_PATTERN.test(value)) {
    throw new Error(
      `${context} is not a canonical UTC instant: ${JSON.stringify(value)}. The timeline merges ` +
        `heterogeneous sources by comparing their time columns AS TEXT, which is chronological only ` +
        `for the exact shape YYYY-MM-DDTHH:mm:ss.sssZ. A variant precision REORDERS THE TIMELINE — ` +
        `"…:00Z" sorts after "…:00.500Z" because '.' precedes 'Z' in byte order — so the page a ` +
        `person reads would silently list events out of order.`,
    );
  }
}

// The comparison the merge and every source's keyset predicate agree on: sort key first, row id as
// the tiebreak so the order is TOTAL. Without the tiebreak, two sources tying on the same key would
// order differently from page to page and a keyset walk would repeat or skip rows at the boundary.
function compareEntries(left: TimelineEntry, right: TimelineEntry, ascending: boolean): number {
  const direction = ascending ? 1 : -1;
  if (left.sortKey !== right.sortKey) return left.sortKey < right.sortKey ? -direction : direction;
  if (left.rowId !== right.rowId) return left.rowId < right.rowId ? -direction : direction;
  return 0;
}

export interface MergedPage {
  readonly entries: readonly TimelineEntry[];
  readonly nextCursor: string | null;
}

// The k-way merge over per-source result sets. Each source has already returned at most
// pageSize + 1 rows in its own order; this picks the top pageSize across all of them and mints the
// next cursor from the LAST KEPT entry — the has-more probe applies to the merged result rather than
// to any one source's.
export function mergeTimelinePages(
  perSourceEntries: readonly (readonly TimelineEntry[])[],
  pageSize: number,
  ascending: boolean,
): MergedPage {
  const combined: TimelineEntry[] = [];
  for (const entries of perSourceEntries) combined.push(...entries);
  combined.sort((left, right) => compareEntries(left, right, ascending));
  const hasMore = combined.length > pageSize;
  const kept = hasMore ? combined.slice(0, pageSize) : combined;
  const last = kept.at(-1);
  return {
    entries: kept,
    // The cursor is the SHIPPED (sort key, id) encoding from the platform's keyset helper, byte
    // identical to every other list read's — the calendar mints no new wire contract of its own.
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.sortKey, last.rowId) : null,
  };
}

export function decodeTimelineCursor(cursor: string | undefined): TimelineCursor | undefined {
  const decoded = decodeCursor(cursor);
  if (decoded === undefined) return undefined;
  return { sortKey: decoded.createdAt, id: decoded.id };
}
