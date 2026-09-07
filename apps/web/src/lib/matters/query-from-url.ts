/*
 * The query a section was asked to answer, read off its own address.
 *
 * The matter is searched from ONE place — the search in the matter header — and a section that can
 * show a result set of its own is handed the query the same way a deep link hands it a record: in
 * the address, under `?q=`, which is the parameter the matter's own results page already uses. A
 * section reading it therefore has no field of its own, and a search survives a reload and can be
 * handed to a colleague.
 *
 * Read from `$app/state`, so a section that reads it inside a rune sees a new address without
 * remounting.
 */
import { page } from "$app/state";

export function queryFromUrl(): string {
  return page.url.searchParams.get("q") ?? "";
}
