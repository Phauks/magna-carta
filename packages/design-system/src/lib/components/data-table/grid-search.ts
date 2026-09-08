/*
 * Searching a grid's rows — the matching rules, as pure functions over the column model.
 *
 * ScreenSearch owns the control and no results; the grid owns the columns. This is the piece
 * between them, and it lives here rather than in each screen because the matching RULES are what a
 * reader forms a habit around: which fields a query reaches, whether two words both have to match,
 * whether a word has to start something. A habit is worth one implementation and a test. The same
 * argument the catalogue's own narrowing settled — and the reason it is stated once for every grid
 * instead of a third time per surface.
 *
 * THE RULES, deliberately the catalogue's, so the product has ONE search grammar:
 *   - The query is split on whitespace and EVERY word must match somewhere in the row. Typing more
 *     words narrows; it never widens.
 *   - A word matches anywhere inside the text, not only at a word's start, so "recon" reaches
 *     "reconciliation".
 *   - Case and surrounding whitespace are nothing. Nothing else is normalized: folding accents or
 *     stemming would make the match rule something a reader has to learn rather than guess.
 *
 * WHAT A WORD IS MATCHED AGAINST is the row as the column model RENDERS it — gridCellText, the same
 * text the cell shows and the same text the double-click fit measures. So a query reaches what the
 * reader can see, and a column whose display text is computed (a state word, a resolved name) is
 * searched by that word rather than by the identifier underneath it, which is what a reader is
 * actually typing.
 *
 * EVERY DECLARED COLUMN, not only the visible ones. Hiding a column is a view choice a reader makes
 * about width; a search whose answer changed with it would be a second narrowing nobody can see.
 *
 * IT NARROWS AND NEVER AUTHORIZES. This runs over rows the server already decided to send, so a
 * surface whose corpus is paged is narrowing what is IN HAND — which is the same scope the grid's
 * own column filters run at, and the surface has to say so where it matters.
 */
import type { GridColumn } from "./grid-columns.ts";
import { gridCellText } from "./grid-columns.ts";

/** The words a query narrows by: lower-cased, whitespace-separated, empties dropped. */
function queryWords(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

/** Everything about a row a query is matched against, as one lower-cased haystack. */
function searchableText<TRow>(columns: readonly GridColumn<TRow>[], row: TRow): string {
  return columns
    .map((column) => gridCellText(column, row))
    .join(" ")
    .toLowerCase();
}

/** Whether one row answers the query. An empty query matches every row. */
export function gridRowMatchesSearch<TRow>(
  columns: readonly GridColumn<TRow>[],
  row: TRow,
  query: string,
): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const haystack = searchableText(columns, row);
  return words.every((word) => haystack.includes(word));
}

/**
 * The rows a query reaches, in their original order.
 *
 * An empty or whitespace-only query returns the rows untouched — the SAME array, so a resting
 * screen costs no work and the grid's `rows` thunk hands back an identity nothing has to re-key on.
 */
export function gridRowsMatchingSearch<TRow>(
  columns: readonly GridColumn<TRow>[],
  rows: readonly TRow[],
  query: string,
): readonly TRow[] {
  if (queryWords(query).length === 0) return rows;
  return rows.filter((row) => gridRowMatchesSearch(columns, row, query));
}
