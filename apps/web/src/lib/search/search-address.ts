/*
 * The Search page's address: one question, in one place, over the matters its reader chose.
 * `?q=` is the words searched for, `?in=` the place, `?scope=` or `?client=` what the search
 * reaches, and `?from=` and `?to=` the days. Where those were read out of a question the reader
 * typed, `?asked=` keeps the question as typed, so the field shows it and the reader can search
 * its words alone. Together they are the whole of the page's state.
 *
 * A module of its own, importing only the shape of a day, because the top bar's palette builds this
 * address for the text a reader typed and must not pull the page's reads into the shell to do it.
 */
import { isCivilDate } from "@magna-carta/civil-time/civil-date";

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

/** A span of days a search is held to, both ends included. Either end may be open. */
export interface SearchDays {
  readonly from?: string;
  readonly to?: string;
}

/** What an address carries beside the words, the place and the matters. */
export interface SearchAddressExtras {
  /** The days, or absent for any day. */
  readonly days?: SearchDays | null;
  /** The question as typed, where a reading of it took something out of the words. */
  readonly asked?: string | null;
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

/** One span of days as one string, for telling two apart. */
export function daysKey(days: SearchDays | null): string {
  return days === null ? "" : `${days.from ?? ""}..${days.to ?? ""}`;
}

/** The address of one question in one place, over the matters and days chosen. */
export function searchAddress(
  query: string,
  place: string = ALL_PLACES,
  reach: SearchReach = EVERYTHING,
  extras: SearchAddressExtras = {},
): string {
  const parameters = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed !== "") parameters.set("q", trimmed);
  if (place !== ALL_PLACES) parameters.set("in", place);
  if (reach.kind === "mine") parameters.set("scope", "mine");
  if (reach.kind === "client") parameters.set("client", reach.entityId);
  if (extras.days?.from !== undefined) parameters.set("from", extras.days.from);
  if (extras.days?.to !== undefined) parameters.set("to", extras.days.to);
  const asked = extras.asked?.trim() ?? "";
  if (asked !== "" && asked !== trimmed) parameters.set("asked", asked);
  const suffix = parameters.toString();
  return suffix === "" ? "/search" : `/search?${suffix}`;
}

/** Whether a place is one the search across matters answers, as opposed to a read by name. */
export function isRecordPlace(place: string): boolean {
  return place !== ALL_PLACES && place !== MATTERS_PLACE && place !== PEOPLE_PLACE;
}
