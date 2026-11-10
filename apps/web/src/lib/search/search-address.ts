/*
 * The Search page's address: one question, in one place. `?q=` is the question and `?in=` the
 * place, and the two are the whole of the page's state.
 *
 * A module of its own, with no imports, because the top bar's palette builds this address for the
 * text a reader typed and must not pull the page's reads into the shell to do it.
 */

/** No place chosen: a few results from each. */
export const ALL_PLACES = "all";
/** Matters found by title, number or client. Not a record place; it has its own read. */
export const MATTERS_PLACE = "matters";
/** People and organizations found by name. Not a record place; it has its own read. */
export const PEOPLE_PLACE = "people";

/** The place an address names. An absent or empty value reads as every place. */
export function placeFromAddress(value: string | null): string {
  if (value === null || value.trim() === "") return ALL_PLACES;
  return value;
}

/** The address of one question in one place. */
export function searchAddress(query: string, place: string = ALL_PLACES): string {
  const parameters = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed !== "") parameters.set("q", trimmed);
  if (place !== ALL_PLACES) parameters.set("in", place);
  const suffix = parameters.toString();
  return suffix === "" ? "/search" : `/search?${suffix}`;
}

/** Whether a place is one the search across matters answers, as opposed to a read by name. */
export function isRecordPlace(place: string): boolean {
  return place !== ALL_PLACES && place !== MATTERS_PLACE && place !== PEOPLE_PLACE;
}
