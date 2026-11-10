/*
 * The Search page's address: one question, in one place, over the matters its reader chose.
 * `?q=` is the question, `?in=` the place, and `?scope=` or `?client=` what the search reaches.
 * Together they are the whole of the page's state.
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

/**
 * The matters a search reaches, as its reader chose them. Every choice is inside what the reader
 * may see: the server decides that, and a choice here only takes matters away.
 */
export type SearchReach =
  | { readonly kind: "everything" }
  /** The matters the reader is responsible for or currently assigned to. */
  | { readonly kind: "mine" }
  /** The matters one person or organization is a client on. */
  | { readonly kind: "client"; readonly entityId: string };

export const EVERYTHING: SearchReach = { kind: "everything" };
export const MY_MATTERS: SearchReach = { kind: "mine" };

/** The place an address names. An absent or empty value reads as every place. */
export function placeFromAddress(value: string | null): string {
  if (value === null || value.trim() === "") return ALL_PLACES;
  return value;
}

/**
 * The reach an address names. A value it does not know reads as everything, which is the search a
 * reader gets with no choice made, and never as an error on a hand-edited address.
 */
export function reachFromAddress(scope: string | null, client: string | null): SearchReach {
  if (scope === "mine") return MY_MATTERS;
  const entityId = client?.trim() ?? "";
  if (entityId !== "") return { kind: "client", entityId };
  return EVERYTHING;
}

/** One reach as one string, for telling two apart. */
export function reachKey(reach: SearchReach): string {
  return reach.kind === "client" ? `client:${reach.entityId}` : reach.kind;
}

/** Whether the reader chose fewer matters than every one they may see. */
export function isNarrowed(reach: SearchReach): boolean {
  return reach.kind !== "everything";
}

/** The address of one question in one place, over the matters chosen. */
export function searchAddress(
  query: string,
  place: string = ALL_PLACES,
  reach: SearchReach = EVERYTHING,
): string {
  const parameters = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed !== "") parameters.set("q", trimmed);
  if (place !== ALL_PLACES) parameters.set("in", place);
  if (reach.kind === "mine") parameters.set("scope", "mine");
  if (reach.kind === "client") parameters.set("client", reach.entityId);
  const suffix = parameters.toString();
  return suffix === "" ? "/search" : `/search?${suffix}`;
}

/** Whether a place is one the search across matters answers, as opposed to a read by name. */
export function isRecordPlace(place: string): boolean {
  return place !== ALL_PLACES && place !== MATTERS_PLACE && place !== PEOPLE_PLACE;
}
