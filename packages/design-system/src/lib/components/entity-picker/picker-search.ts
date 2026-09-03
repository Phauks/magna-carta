/*
 * The rules around a directory search, separated from the field that runs them.
 *
 * Every picker over the directory that existed before this one carried the same three decisions in
 * its own words: how long typed text settles before it is sent, how short a query is too short to ask,
 * and what a search that could not run is shown as. They are pure, they are settled behaviour rather
 * than presentation, and they are the part a rendered field cannot show — so they live here, tested on
 * their own, and the field calls them.
 */
import type { EntityPickerAnswer, EntitySearch, PickableEntity } from "./types.ts";

/**
 * How long typed text settles before it is asked. A directory search per keystroke is a request per
 * keystroke asking the firm's record a question nobody has finished asking.
 */
export const SEARCH_SETTLE_MILLISECONDS = 250;

/**
 * The shortest query worth asking. The directory's name corpus matches three-character windows, so a
 * shorter query can match nothing at all — and a floor that is silent looks like a search that found
 * nothing. The picker states it instead.
 */
export const DEFAULT_MINIMUM_QUERY_LENGTH = 3;

/** What a typed query becomes once it is decided whether it can be asked. */
export type SearchRequest =
  | { kind: "nothing" }
  | { kind: "too-short"; missing: number }
  | { kind: "ask"; query: string };

/**
 * Decides whether typed text is a question the directory can be asked.
 *
 * Whitespace on either side is not part of the question; a query that is nothing but whitespace is no
 * question at all, and is `nothing` rather than `too-short` so the field does not tell a reader who
 * cleared it that they have more to type.
 */
export function searchRequestFor(typed: string, minimumQueryLength: number): SearchRequest {
  const query = typed.trim();
  if (query === "") return { kind: "nothing" };
  if (query.length < minimumQueryLength) {
    return { kind: "too-short", missing: minimumQueryLength - query.length };
  }
  return { kind: "ask", query };
}

/** The one sentence for a query below the floor, so every picker says it the same way. */
export function tooShortSentence(missing: number): string {
  return missing === 1
    ? "Type one more character to search the directory."
    : `Type ${String(missing)} more characters to search the directory.`;
}

/** What one search came back with, or that it could not run. */
export type SearchOutcome =
  | { kind: "answered"; answer: EntityPickerAnswer }
  | { kind: "failed" }
  | { kind: "superseded" };

/**
 * Runs one search and turns every way it can end into a value.
 *
 * A search the caller's function rejects is `failed`, and so is one that throws synchronously —
 * a picker must never let a failed fetch surface as an empty list. A search whose signal was aborted
 * before it answered is `superseded`: a newer question is out, and whatever this one would have said
 * is not the answer to it.
 */
export async function runEntitySearch(
  search: EntitySearch,
  query: string,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  try {
    const answer = await search(query, signal);
    if (signal.aborted) return { kind: "superseded" };
    return { kind: "answered", answer };
  } catch {
    if (signal.aborted) return { kind: "superseded" };
    return { kind: "failed" };
  }
}

/**
 * The hits the picker may offer: everything the search found, less what the caller excluded.
 *
 * Exclusion is by handle and never by name — two records can share a name, and leaving out the wrong
 * one hides the record a reader is looking for. The order is preserved: it is the server's relevance
 * order, and a picker that re-sorted a capped answer would put the best of an arbitrary slice at the
 * top and read as the best of the firm's record.
 */
export function offerableEntities(
  hits: readonly PickableEntity[],
  excluded: readonly string[],
): PickableEntity[] {
  if (excluded.length === 0) return [...hits];
  const left = new Set(excluded);
  return hits.filter((hit) => !left.has(hit.identifier));
}

/** The one sentence for a capped answer, so every picker says it the same way. */
export const CAPPED_SENTENCE =
  "The firm holds more matches than are shown. These are the closest; narrowing the search reaches the rest.";
