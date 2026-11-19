/*
 * The Search page's address: one question and the filters beside it. `?q=` is the words searched
 * for; `?in=` (repeatable) the places ticked; `?scope=mine`, `?client=` or `?matter=` (repeatable)
 * the matters; `?from=` and `?to=` the days; `?by=` the one member whose rows are wanted. Together
 * they are the whole of the page's state, so a reload, a shared link and the back button all land
 * on the same search.
 *
 * A module of its own, importing only the shape of a day, because the top bar's palette builds this
 * address for the text a reader typed and must not pull the page's reads into the shell to do it.
 */
import { isCivilDate } from "@magna-carta/civil-time/civil-date";

/** Matters found by title, number or client. Not a record place; it has its own read. */
export const MATTERS_PLACE = "matters";
/** People and organizations found by name. Not a record place; it has its own read. */
export const PEOPLE_PLACE = "people";

/**
 * The most matters a reader may name one by one. The server's own limit, and the number of matters
 * the words inside files are searched across, so naming matters never costs a reader that place.
 */
export const CHOSEN_MATTERS_LIMIT = 25;

/**
 * The matters a search reaches, as its reader chose them. Every choice is inside what the reader
 * may see: the server decides that, and a choice here only takes matters away.
 */
export type SearchReach =
  | { readonly kind: "everything" }
  /** The matters the reader is responsible for or currently assigned to. */
  | { readonly kind: "mine" }
  /** The matters one person or organization is a client on. */
  | { readonly kind: "client"; readonly entityId: string }
  /** The matters the reader named one by one. */
  | { readonly kind: "matters"; readonly matterIds: readonly string[] };

export const EVERYTHING: SearchReach = { kind: "everything" };
export const MY_MATTERS: SearchReach = { kind: "mine" };

/** A span of days a search is held to, both ends included. Either end may be open. */
export interface SearchDays {
  readonly from?: string;
  readonly to?: string;
}

/** Everything beside the words that decides what a search answers. */
export interface SearchFilters {
  /**
   * The places ticked, or null for the places a search ticks before the reader changes anything:
   * every record place, and not matters or people by name.
   */
  readonly places: readonly string[] | null;
  readonly reach: SearchReach;
  /** The days, or null for any day. */
  readonly days: SearchDays | null;
  /** The one member whose rows are wanted, or null for anyone. */
  readonly by: string | null;
}

export const NO_FILTERS: SearchFilters = { places: null, reach: EVERYTHING, days: null, by: null };

/** Whether a place is one the search across matters answers, as opposed to a read by name. */
export function isRecordPlace(place: string): boolean {
  return place !== MATTERS_PLACE && place !== PEOPLE_PLACE;
}

/** Whether a place is ticked. Nothing chosen ticks the record places and leaves names unticked. */
export function placeTicked(filters: SearchFilters, place: string): boolean {
  if (filters.places === null) return isRecordPlace(place);
  return filters.places.includes(place);
}

/**
 * The reach an address names. A value it does not know reads as everything, which is the search a
 * reader gets with no choice made, and never as an error on a hand-edited address.
 */
export function reachFromAddress(parameters: URLSearchParams): SearchReach {
  if (parameters.get("scope") === "mine") return MY_MATTERS;
  const entityId = parameters.get("client")?.trim() ?? "";
  if (entityId !== "") return { kind: "client", entityId };
  const matterIds = [...new Set(parameters.getAll("matter").map((value) => value.trim()))].filter(
    (value) => value !== "",
  );
  if (matterIds.length > 0) {
    return { kind: "matters", matterIds: matterIds.slice(0, CHOSEN_MATTERS_LIMIT) };
  }
  return EVERYTHING;
}

/**
 * The days an address names, or null for any day. A value that is not a real day is left out
 * rather than refused, as an unknown reach is.
 */
export function daysFromAddress(from: string | null, to: string | null): SearchDays | null {
  const first = isCivilDate(from) ? from : undefined;
  const last = isCivilDate(to) ? to : undefined;
  if (first === undefined && last === undefined) return null;
  return {
    ...(first === undefined ? {} : { from: first }),
    ...(last === undefined ? {} : { to: last }),
  };
}

/** Every filter an address names. */
export function filtersFromAddress(parameters: URLSearchParams): SearchFilters {
  const places = [...new Set(parameters.getAll("in").map((value) => value.trim()))].filter(
    (value) => value !== "",
  );
  const by = parameters.get("by")?.trim() ?? "";
  return {
    places: places.length === 0 ? null : places,
    reach: reachFromAddress(parameters),
    days: daysFromAddress(parameters.get("from"), parameters.get("to")),
    by: by === "" ? null : by,
  };
}

/** One reach as one string, for telling two apart. */
export function reachKey(reach: SearchReach): string {
  if (reach.kind === "client") return `client:${reach.entityId}`;
  if (reach.kind === "matters") return `matters:${reach.matterIds.toSorted().join(",")}`;
  return reach.kind;
}

/** Whether the reader chose fewer matters than every one they may see. */
export function isNarrowed(reach: SearchReach): boolean {
  return reach.kind !== "everything";
}

/** One span of days as one string, for telling two apart. */
export function daysKey(days: SearchDays | null): string {
  return days === null ? "" : `${days.from ?? ""}..${days.to ?? ""}`;
}

/**
 * The filters that decide what the server is asked, as one string. The places are not in it: every
 * place is asked whichever are ticked, so the panel can count the ones that are not.
 */
export function askedKey(filters: SearchFilters): string {
  return `${reachKey(filters.reach)}|${daysKey(filters.days)}|${filters.by ?? ""}`;
}

/** The address of one question under the filters chosen. */
export function searchAddress(query: string, filters: Partial<SearchFilters> = {}): string {
  const parameters = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed !== "") parameters.set("q", trimmed);
  for (const place of filters.places ?? []) parameters.append("in", place);
  const reach = filters.reach ?? EVERYTHING;
  if (reach.kind === "mine") parameters.set("scope", "mine");
  if (reach.kind === "client") parameters.set("client", reach.entityId);
  if (reach.kind === "matters") {
    for (const matterId of reach.matterIds) parameters.append("matter", matterId);
  }
  if (filters.days?.from !== undefined) parameters.set("from", filters.days.from);
  if (filters.days?.to !== undefined) parameters.set("to", filters.days.to);
  if (filters.by !== undefined && filters.by !== null) parameters.set("by", filters.by);
  const suffix = parameters.toString();
  return suffix === "" ? "/search" : `/search?${suffix}`;
}
