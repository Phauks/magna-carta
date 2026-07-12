/*
 * What the file surface's HOST hands down to every view. The sort lives here rather than inside a
 * view because it is a property of the query, not of a presentation: the server orders the whole
 * matter and returns a page of that order, so a view can only ASK for a sort — it cannot perform one
 * without answering the wrong question (the largest file of the loaded page, not of the matter).
 *
 * Keeping it in the context also means every view gets sorting, not just the table: a grid ordered
 * newest-first is the chronology, which is why the surface needs no separate chronological view.
 */
import type { FileSort, FileSortKey } from "./file-sort.ts";

export interface FilesViewContext {
  /** The sort in force, which the host reads from the URL. */
  readonly sort: FileSort;
  /** Ask for a column: the active column reverses, another switches to its natural direction. */
  onSortByColumn(key: FileSortKey): void;
}
