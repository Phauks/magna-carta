/*
 * The record a section was asked to open, read off its own address.
 *
 * Every deep link the platform's timeline builds is `/matters/{id}/{section}?entry={rowId}` — the
 * matter's Activity section, its search results and anything else that consolidates the matter's
 * record all hand a section the same parameter. A section honours it by opening that record the way
 * it opens any other: the note in its window, the file in the inspector, the packet in its window,
 * the calendar row marked and scrolled to. What it must never do is land the reader on the list and
 * leave them to find the thing again.
 *
 * Read from `$app/state`, so a section that reads it inside a rune sees a new address without
 * remounting.
 */
import { page } from "$app/state";

export function entryFromUrl(): string | null {
  const entry = page.url.searchParams.get("entry");
  return entry === null || entry.length === 0 ? null : entry;
}
