/*
 * AddressLookupPort — the one chokepoint an address suggestion is asked for through, named in our
 * domain vocabulary rather than an engine's or a vendor's. Two operations: offer addresses for what
 * somebody has typed so far (`suggest`), and turn one of those offers into the parts a record stores
 * (`resolve`). Every operation returns a typed outcome and never throws, the same discipline as
 * SearchIndexPort and the integrations Dispatch — a caller pattern-matches rather than catches.
 *
 * THE INDEX IS FLEET-WIDE REFERENCE DATA, AND THAT INVERTS THE DISCOVERY MODEL. A discovery split is
 * a firm's own content: it lives in that firm's bucket, the caller names every key, and a read is
 * guarded by a capability token. An address index is a public corpus — the same streets for every
 * firm — so there is one copy, it carries no firm's data, and nothing here takes a firm id. Do not
 * copy the firm-scoping machinery from packages/search into an implementation of this port; there is
 * no tenancy decision to make, and machinery that implies one is worse than none.
 *
 * WHAT DOES CROSS IS THE QUERY, AND THE QUERY IS A CLIENT'S ADDRESS. The index holds nothing of the
 * firm's, but a person typing "14 Rosewood" into a matter is typing a client's home, and that text
 * reaches whatever serves this port. So an implementation stores none of it: no log line carrying
 * query text, no cache keyed on it, nothing held between calls. The inverse of the rule
 * containers/search keeps, and it has to be stated in this direction because nothing about the index
 * itself would suggest it.
 *
 * NOTHING HERE VALIDATES, AND NOTHING HERE VERIFIES. A suggestion says a place is known to a public
 * corpus of addresses. It does not say mail is deliverable there, and it must never be rendered as
 * though it did — deliverability is a licensed postal-data question that no open corpus answers, and
 * it lands in the verification columns through a different port entirely.
 */

/**
 * The parts a suggestion would fill, named for their POSITION in an address rather than for what any
 * one country calls them — the international field set, matching the columns a record stores.
 *
 * The field set is spelled out here rather than imported because the two places that also carry it
 * cannot serve this one: the database's columns are a schema, and the design system's `AddressParts`
 * belongs to a Svelte package a Worker must not import. The same reason `packages/shipping` states
 * its own canonical address rather than borrowing one.
 */
export interface SuggestedAddressParts {
  readonly street?: string;
  readonly streetTwo?: string;
  readonly dependentLocality?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postal?: string;
  readonly sortingCode?: string;
  /** ISO 3166-1 alpha-2. */
  readonly country?: string;
}

/** One address offered for what has been typed so far. */
export interface AddressSuggestion {
  /**
   * The engine's handle for this offer, opaque to every caller and meaningful only to `resolve`.
   * Opaque because what identifies a row is the index's business: a caller that parsed one would
   * be depending on a detail the next index build is free to change.
   */
  readonly suggestionId: string;
  /**
   * The whole address on one line, for the list a person reads. Assembled by the engine, because
   * how an address reads in a list is a property of the country it is in.
   */
  readonly label: string;
  /** What choosing this offer would put in the record. */
  readonly parts: SuggestedAddressParts;
}

export interface SuggestInput {
  /** What has been typed so far. Never stored, never logged — see the note at the top of this file. */
  readonly query: string;
  /**
   * The country to search, ISO 3166-1 alpha-2. Required rather than inferred: the country is already
   * the first field of the address form because it decides the rest, and an engine guessing it from
   * a fragment would offer a street in the wrong hemisphere as confidently as the right one.
   */
  readonly country: string;
  /** How many offers to return at most. An engine may return fewer, never more. */
  readonly limit?: number;
}

export interface ResolveInput {
  readonly suggestionId: string;
}

/**
 * A failure the whole port shares.
 *
 * `engine-not-implemented` is first-class because the engine is deferred — the seam ships before it
 * does, so every caller is written against a port that answers honestly rather than against one that
 * does not exist yet.
 *
 * `no-coverage` is first-class for a different and more important reason: the open address corpora
 * cover countries very unevenly, and "we hold no addresses for this country" is NOT "we found no
 * match for what you typed". Folding the two together would tell somebody their client's address is
 * wrong when the truth is that nobody has published that country's addresses. It is the difference
 * between a correction and an apology.
 */
export type AddressLookupFailureReason = "engine-not-implemented" | "no-coverage" | "adapter-error";

export interface AddressLookupFailure {
  readonly ok: false;
  readonly reason: AddressLookupFailureReason;
  readonly detail?: string;
}

/** An empty `suggestions` is a real answer: the country is covered and nothing matched. */
export type SuggestResult =
  | { readonly ok: true; readonly suggestions: readonly AddressSuggestion[] }
  | AddressLookupFailure;

/**
 * `parts: undefined` is the offer having expired — a suggestion the engine no longer knows, because
 * the index was rebuilt between the offer and the choice. Distinct from a failure: nothing went
 * wrong, and the caller simply asks again.
 */
export type ResolveResult =
  | { readonly ok: true; readonly parts: SuggestedAddressParts | undefined }
  | AddressLookupFailure;

export interface AddressLookupPort {
  suggest(input: SuggestInput): Promise<SuggestResult>;
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

// ── Smart constructors ──────────────────────────────────────────────────────

export function suggested(suggestions: readonly AddressSuggestion[]): SuggestResult {
  return { ok: true, suggestions };
}

export function resolved(parts: SuggestedAddressParts | undefined): ResolveResult {
  return { ok: true, parts };
}

/** The deferred state: no engine is reachable. Assignable to either result union. */
export function addressEngineNotImplemented(): AddressLookupFailure {
  return { ok: false, reason: "engine-not-implemented" };
}

/** The corpus holds no addresses for that country at all. Not a match failure. */
export function addressCountryNotCovered(country: string): AddressLookupFailure {
  return { ok: false, reason: "no-coverage", detail: country };
}

export function addressAdapterError(detail: string): AddressLookupFailure {
  return { ok: false, reason: "adapter-error", detail };
}

/**
 * The port every caller gets until an engine is deployed: it answers `engine-not-implemented` to
 * everything.
 *
 * This is the whole reason the seam can ship alone. A surface written against this port degrades to
 * exactly today's behaviour — a person types the address themselves — with no branch at the call
 * site and no flag to remove later, and the day an engine exists the only thing that changes is
 * which port is handed in. The same shape `resolveSearchIndexPort` takes for the discovery engine.
 */
export function deferredAddressLookupPort(): AddressLookupPort {
  return {
    suggest: () => Promise.resolve(addressEngineNotImplemented()),
    resolve: () => Promise.resolve(addressEngineNotImplemented()),
  };
}
