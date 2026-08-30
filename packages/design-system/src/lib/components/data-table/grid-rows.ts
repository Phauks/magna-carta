/*
 * Grid row groups and row marks — the two settled things a list says about a row before it says
 * anything about that row's data.
 *
 * GROUPS. Pinned items sit above EVERYTHING, separated by a rule, rather than above their own
 * kind: a pinned folder and a pinned file share one block at the top, and the rule is what tells
 * a reader the block is a different thing from the list beneath it. Their order inside that block
 * is the member's own arrangement, not the table's sort — pinning is an act of arranging, so the
 * sort does not get to undo it.
 *
 * MARKS. A mark is what the list says about a row's standing, and it is one vocabulary so two
 * surfaces cannot disagree: the pin (one Lucide glyph, fill the only difference between pinned and
 * not), a clipboard mark while a row waits on a cut or a copy, and a quieter voice for a row that
 * is present but not of the list's own kind — a deleted file among live search results, an event a
 * row inherited from a folder act rather than one somebody performed on it.
 *
 * Pure functions: the runes state groups the rows, the grid renders the rule and the marks.
 */

/** How a row is marked before its data is read. Every field is independent; a row may carry all. */
export interface GridRowMark {
  /** Pinned to the top: renders the filled pin ahead of the row's first cell. */
  pinned?: boolean;
  /** Waiting on a clipboard act — the row looks different while it is marked. */
  clipboard?: "cut" | "copy";
  /** Present but not of the list's own kind: a deleted match, an inherited event. Renders quieter. */
  quiet?: boolean;
}

/** Rows in render order with the size of the leading pinned block (0 when nothing is pinned). */
export interface GridRowGrouping<TRow> {
  rows: readonly TRow[];
  /** How many leading rows are pinned — the index the separating rule renders at. */
  pinnedCount: number;
}

/**
 * The rows in render order: the pinned block first in the member's arranged order, then everything
 * else in the order it arrived (already filtered and sorted). A pinned key naming a row that is not
 * in view contributes nothing — a filter is the reader's own ask, and the footer's "n of m" would
 * be a lie if a pinned row slipped past it.
 */
export function groupedGridRows<TRow>(
  rows: readonly TRow[],
  pinnedKeys: readonly string[],
  rowKey: (row: TRow) => string,
): GridRowGrouping<TRow> {
  if (pinnedKeys.length === 0) return { rows, pinnedCount: 0 };
  const pinned = new Set(pinnedKeys);
  const byKey = new Map(rows.map((row) => [rowKey(row), row]));
  const leading: TRow[] = [];
  for (const key of pinnedKeys) {
    const row = byKey.get(key);
    if (row !== undefined) leading.push(row);
  }
  if (leading.length === 0) return { rows, pinnedCount: 0 };
  return {
    rows: [...leading, ...rows.filter((row) => !pinned.has(rowKey(row)))],
    pinnedCount: leading.length,
  };
}

/** The row's mark attributes, ready to spread onto the `<tr>`; absent fields render no attribute. */
export function gridRowMarkAttributes(mark: GridRowMark | undefined): {
  "data-row-pinned"?: "true";
  "data-clipboard"?: "cut" | "copy";
  "data-quiet"?: "true";
} {
  if (mark === undefined) return {};
  return {
    ...(mark.pinned === true ? { "data-row-pinned": "true" as const } : {}),
    ...(mark.clipboard === undefined ? {} : { "data-clipboard": mark.clipboard }),
    ...(mark.quiet === true ? { "data-quiet": "true" as const } : {}),
  };
}
