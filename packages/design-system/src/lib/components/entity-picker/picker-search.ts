/*
 * The rules around a directory search, separated from the field that runs them.
 *
 * Every picker over the directory that existed before this one carried the same three decisions in
 * its own words: how long typed text settles before it is sent, how short a query is too short to ask,
 * and what a search that could not run is shown as. They are pure, they are settled behaviour rather
 * than presentation, and they are the part a rendered field cannot show — so they live here, tested on
 * their own, and the field calls them.
 */
import type { EntityKind } from "../entity-identity/types.ts";
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
  "More matches exist than are shown. Narrow the search to see the rest.";

/*
 * Making the record the directory does not hold, from the field that failed to find it.
 *
 * A picker that can only choose sends a person who typed a name the firm has never recorded to
 * another screen, and the sentence they were halfway through is lost on the way. So a picker whose
 * caller can create offers it in two places: a top-level New control beside the field, reachable
 * before anything is typed, and a row at the end of the list that adds what was typed. The list's
 * rows are options, and an option carries a value, so the add row carries a RESERVED value per kind
 * (the caller has to be told whether a person or an organization is wanted) that no handle in this
 * product produces.
 */
const ADD_ROW_VALUE_PREFIX = "mc-entity-picker:add:";

/** The reserved option value for the row that adds a record of `kind`. */
export function addRowValue(kind: EntityKind): string {
  return `${ADD_ROW_VALUE_PREFIX}${kind}`;
}

/** Which kind an add row's value asks for, or null when the value is an ordinary pick. */
export function addRowKind(value: string): EntityKind | null {
  if (!value.startsWith(ADD_ROW_VALUE_PREFIX)) return null;
  const kind = value.slice(ADD_ROW_VALUE_PREFIX.length);
  return kind === "person" || kind === "organization" ? kind : null;
}

/** What each side of the directory is called inside the add row's sentence. */
const KIND_WORD: Readonly<Record<EntityKind, string>> = {
  person: "a person",
  organization: "an organization",
};

/**
 * What the add row says when the field offers BOTH kinds and so has to say which one it will make:
 * `Add "Northwind Couriers" as an organization`. A field that offers one kind uses the combobox's
 * own add row and its shorter sentence, because there is nothing to disambiguate.
 */
export function addRowSentence(kind: EntityKind, typed: string): string {
  const trimmed = typed.trim();
  return trimmed === "" ? `Add ${KIND_WORD[kind]}` : `Add "${trimmed}" as ${KIND_WORD[kind]}`;
}

/** The New control's label: the product's one word for making something, bare, as the create control reads it. */
export const NEW_CONTROL_LABEL = "New";

/** The New control's accessible name, which says what it makes: "New person", "New person or organization". */
export function newControlName(kinds: readonly EntityKind[]): string {
  const words = kinds.map((kind) => (kind === "person" ? "person" : "organization"));
  return `New ${words.join(" or ")}`;
}
