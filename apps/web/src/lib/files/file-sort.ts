/*
 * The file surface's sort model — pure, so it is unit-testable without a DOM, and TOTAL, so a
 * hand-edited or stale URL can never put the page into a state the server will reject.
 *
 * Sorting is a QUERY, not a view. The server orders the whole matter and pages the result; the client
 * only says which column and which way. That is what makes "the largest file" mean the largest file
 * in the matter rather than the largest of the page that happened to be loaded — and it is why there
 * is no chronological "view": a list ordered by date IS the chronology, in whichever view you prefer.
 */

/** The columns the server can order by. Mirrors the `sort` enum on files.list. */
export const FILE_SORT_KEYS = ["name", "createdAt", "updatedAt", "sizeBytes"] as const;
export type FileSortKey = (typeof FILE_SORT_KEYS)[number];

export type FileSortDirection = "asc" | "desc";

/** Newest first — the order the file list has always come back in. */
export const DEFAULT_SORT_KEY: FileSortKey = "createdAt";
export const DEFAULT_SORT_DIRECTION: FileSortDirection = "desc";

export interface FileSort {
  readonly key: FileSortKey;
  readonly direction: FileSortDirection;
}

/** The column headings, in the order the table presents them. */
export const FILE_SORT_LABELS: Record<FileSortKey, string> = {
  name: "Name",
  createdAt: "Created",
  updatedAt: "Modified",
  sizeBytes: "Size",
};

/**
 * Which way a column runs when it is first chosen. A name reads A-to-Z; a date or a size is asked
 * about newest-or-biggest first, because that is the question people actually have ("what came in
 * last?", "what is the huge one?"). Choosing per column beats one global default that is wrong half
 * the time.
 */
export function defaultDirectionFor(key: FileSortKey): FileSortDirection {
  return key === "name" ? "asc" : "desc";
}

/** Total: anything that is not a known column folds to the default. */
export function parseFileSortKey(raw: string | null): FileSortKey {
  return FILE_SORT_KEYS.includes(raw as FileSortKey) ? (raw as FileSortKey) : DEFAULT_SORT_KEY;
}

/** Total: anything that is not a known direction folds to the default. */
export function parseFileSortDirection(raw: string | null): FileSortDirection {
  return raw === "asc" || raw === "desc" ? raw : DEFAULT_SORT_DIRECTION;
}

/**
 * What clicking a column heading means: the column you are already sorted by REVERSES, and any other
 * column switches to its own natural direction. This is the table idiom everywhere, and it is why a
 * first click never appears to do nothing.
 */
export function sortAfterHeadingClick(current: FileSort, key: FileSortKey): FileSort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: defaultDirectionFor(key) };
}

/** The `aria-sort` value for a column heading — "none" unless this is the column in force. */
export function ariaSortFor(current: FileSort, key: FileSortKey): "ascending" | "descending" | "none" {
  if (current.key !== key) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}
