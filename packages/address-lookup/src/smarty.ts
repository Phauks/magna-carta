/*
 * The Smarty adapter: AddressLookupPort over Smarty's two autocomplete services.
 *
 * WHY THIS PROVIDER, IN ONE SENTENCE: the address a person picks is written into a permanent record,
 * and Smarty's terms let the firm keep it. The two largest autocomplete services do not — one permits
 * storing only its own place identifier, the other treats every result as temporary — which rules
 * them out for a product whose whole purpose is to hold the address afterwards. Keeping the data is
 * not a nicety here; it is the requirement.
 *
 * TWO SERVICES BEHIND ONE PORT, CHOSEN BY COUNTRY. The United States goes to US Autocomplete Pro,
 * which answers from postal data and returns the parts of each address directly. Everywhere else goes
 * to International Autocomplete, which answers in two steps: a free search returning a line of text
 * and an identifier, then a charged lookup of that identifier returning the parts. The port hides the
 * difference — a caller asks `suggest`, then `resolve` — and the adapter pays for the second step only
 * when somebody actually chooses an offer.
 *
 * BOTH SERVICES RETURN GROUPS. A building with many units comes back as one line with a count, and
 * the units are a second request away. That is what `kind: "group"` on the port is for.
 *
 * THE QUERY IS A CLIENT'S ADDRESS. Nothing here logs it, and no failure this adapter reports carries
 * it: a failure's `detail` is a fixed sentence and, at most, the provider's status code. The request
 * URL is never quoted either — Smarty authenticates server-side calls with the credentials in the
 * query string, so the URL carries the secret as well as the address.
 *
 * Pure: `fetch` is injected, nothing reads `env`, and nothing is held between calls.
 */
import { alphaThreeFor, alphaTwoFor } from "./country-alpha-three.ts";
import { decodeOpaqueHandle, encodeOpaqueHandle, partsFrom } from "./opaque-handle.ts";
import {
  addressAdapterError,
  addressCountryNotCovered,
  resolutionExpired,
  resolvedAddress,
  resolvedGroup,
  suggested,
  type AddressLookupFailure,
  type AddressLookupPort,
  type AddressSuggestion,
  type ResolveResult,
  type SuggestedAddressParts,
  type SuggestResult,
} from "./port.ts";

/** The account's secret key pair, as Smarty issues it for server-side calls. */
export interface SmartyCredentials {
  readonly authenticationIdentifier: string;
  readonly authenticationToken: string;
}

/** The fetch this adapter calls through — injected so a test never reaches the network. */
export type SmartyFetch = (url: string, init?: RequestInit) => Promise<Response>;

const UNITED_STATES_ENDPOINT = "https://us-autocomplete-pro.api.smarty.com/lookup";
const INTERNATIONAL_ENDPOINT = "https://international-autocomplete.api.smarty.com/v2/lookup";

/**
 * Both services refuse a search longer than this. What has been typed is a PREFIX, so the first
 * thirty-two characters are still the right question — a person who has typed more than that has
 * almost always already been offered their address.
 */
export const SEARCH_CHARACTER_LIMIT = 32;

/** Both services cap an answer at ten. */
const MOST_OFFERS = 10;
const DEFAULT_OFFERS = 8;

/**
 * An offer nobody is waiting for is worth nothing. A person types past a slow answer within a second
 * or two, so a request that has not come back by then is abandoned rather than allowed to hold the
 * Worker open.
 */
const REQUEST_TIMEOUT_MILLISECONDS = 4000;

// ── Suggestion identifiers ──────────────────────────────────────────────────
//
// Opaque to every caller, and carrying exactly what `resolve` needs to answer without a lookup table
// on this side. A US address carries its own parts, so resolving it costs nothing and reaches nobody;
// a US group carries the `selected` string the service asks for to open it; an international offer
// carries the service's own identifier. The identifier travels to the browser and back in a request
// BODY — never a URL — because it can hold an address.

type Handle =
  | { readonly route: "united-states-address"; readonly parts: SuggestedAddressParts }
  | { readonly route: "united-states-group"; readonly street: string; readonly selected: string }
  | { readonly route: "international"; readonly country: string; readonly identifier: string }
  | { readonly route: "international-address"; readonly parts: SuggestedAddressParts };

function encodeHandle(handle: Handle): string {
  return encodeOpaqueHandle(handle);
}

/**
 * Decode a handle, or undefined for anything malformed. An identifier came back from a browser, so it
 * is untrusted input: a shape this adapter did not mint is an offer it does not know, which is the
 * port's `expired` answer rather than an error.
 */
function decodeHandle(suggestionId: string): Handle | undefined {
  const handle = decodeOpaqueHandle(suggestionId);
  if (handle === undefined) return undefined;
  switch (handle.route) {
    case "united-states-address":
    case "international-address": {
      const parts = partsFrom(handle.parts);
      return parts === undefined ? undefined : { route: handle.route, parts };
    }
    case "united-states-group":
      return typeof handle.street === "string" && typeof handle.selected === "string"
        ? { route: "united-states-group", street: handle.street, selected: handle.selected }
        : undefined;
    case "international":
      return typeof handle.country === "string" && typeof handle.identifier === "string"
        ? { route: "international", country: handle.country, identifier: handle.identifier }
        : undefined;
    default:
      return undefined;
  }
}

// ── Talking to the services ─────────────────────────────────────────────────

type Fetched = { readonly ok: true; readonly body: unknown } | AddressLookupFailure;

/**
 * One request, and a failure that says what happened without saying what was asked. The status code
 * is the only thing carried from the provider: a refused key (401), a spent subscription (402), a
 * throttle (429) each send somebody to a different place, and none of them needs the query to say so.
 */
async function request(
  fetchImplementation: SmartyFetch,
  endpoint: string,
  parameters: Record<string, string>,
): Promise<Fetched> {
  const url = `${endpoint}?${new URLSearchParams(parameters).toString()}`;
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    return addressAdapterError("The address service did not answer in time.");
  }
  if (!response.ok) {
    return addressAdapterError(
      `The address service refused the request (status ${String(response.status)}).`,
    );
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return addressAdapterError("The address service answered with something that was not JSON.");
  }
}

function credentialParameters(credentials: SmartyCredentials): Record<string, string> {
  return {
    "auth-id": credentials.authenticationIdentifier,
    "auth-token": credentials.authenticationToken,
  };
}

function offerCount(limit: number | undefined): string {
  const wanted = Math.trunc(limit ?? DEFAULT_OFFERS);
  return String(Math.min(MOST_OFFERS, Math.max(1, wanted)));
}

function searchFor(query: string): string {
  return query.trim().slice(0, SEARCH_CHARACTER_LIMIT);
}

function textOf(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberOf(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function listOf(body: unknown, key: string): readonly Record<string, unknown>[] {
  if (typeof body !== "object" || body === null) return [];
  const list = (body as Record<string, unknown>)[key];
  return Array.isArray(list)
    ? list.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
    : [];
}

function withoutEmpty(parts: Record<string, string>): SuggestedAddressParts {
  return Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== ""));
}

// ── The United States ───────────────────────────────────────────────────────

function unitedStatesParts(row: Record<string, unknown>): SuggestedAddressParts {
  return withoutEmpty({
    street: textOf(row, "street_line"),
    streetTwo: textOf(row, "secondary"),
    city: textOf(row, "city"),
    region: textOf(row, "state"),
    postal: textOf(row, "zipcode"),
    country: "US",
  });
}

/** How a US address reads on one line: the way it is written on an envelope, less the line breaks. */
function unitedStatesLabel(parts: SuggestedAddressParts): string {
  const street = [parts.street, parts.streetTwo].filter(Boolean).join(" ");
  const place = [parts.city, [parts.region, parts.postal].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, place].filter(Boolean).join(", ");
}

function unitedStatesOffer(row: Record<string, unknown>): AddressSuggestion | undefined {
  const parts = unitedStatesParts(row);
  if (parts.street === undefined) return undefined;
  const entries = numberOf(row, "entries");
  const label = unitedStatesLabel(parts);
  if (entries > 1) {
    // The service's own format for asking what is inside a group, spelled exactly as it documents
    // it: street line, secondary, the count in parentheses, city, state, ZIP code.
    const selected = [
      parts.street,
      parts.streetTwo,
      `(${String(entries)})`,
      parts.city,
      parts.region,
      parts.postal,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      suggestionId: encodeHandle({ route: "united-states-group", street: parts.street, selected }),
      label,
      parts,
      kind: "group",
      count: entries,
    };
  }
  return {
    suggestionId: encodeHandle({ route: "united-states-address", parts }),
    label,
    parts,
    kind: "address",
  };
}

function unitedStatesOffers(body: unknown): readonly AddressSuggestion[] {
  return listOf(body, "suggestions")
    .map(unitedStatesOffer)
    .filter((offer): offer is AddressSuggestion => offer !== undefined);
}

// ── Everywhere else ─────────────────────────────────────────────────────────

function internationalParts(
  row: Record<string, unknown>,
  askedCountry: string,
): SuggestedAddressParts {
  const alphaThree = textOf(row, "country_iso3");
  return withoutEmpty({
    street: textOf(row, "street"),
    dependentLocality: textOf(row, "dependent_locality"),
    city: textOf(row, "locality"),
    // The short form where the service has one: it is what a country's own post writes ("NB", not
    // "New Brunswick"), and it is the value the address form's administrative-area list stores.
    region: textOf(row, "administrative_area_short") || textOf(row, "administrative_area"),
    postal: textOf(row, "postal_code"),
    // The country the service says, or the one that was asked about where it says none.
    country: alphaTwoFor(alphaThree) ?? askedCountry,
  });
}

/** A summary row: a line of text and the service's identifier, the parts a charged lookup away. */
function internationalSummaryOffer(
  row: Record<string, unknown>,
  alphaThree: string,
  alphaTwo: string,
): AddressSuggestion | undefined {
  const identifier = textOf(row, "address_id");
  const label = textOf(row, "address_text");
  if (identifier === "" || label === "") return undefined;
  const entries = numberOf(row, "entries");
  return {
    suggestionId: encodeHandle({ route: "international", country: alphaThree, identifier }),
    label,
    parts: { country: alphaTwo },
    ...(entries > 1 ? { kind: "group" as const, count: entries } : { kind: "address" as const }),
  };
}

/** A detailed row: the parts are in hand, so choosing it needs no further request. */
function internationalDetailedOffer(
  row: Record<string, unknown>,
  askedCountry: string,
): AddressSuggestion | undefined {
  const parts = internationalParts(row, askedCountry);
  if (parts.street === undefined) return undefined;
  const label = [parts.street, parts.city, [parts.region, parts.postal].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    suggestionId: encodeHandle({ route: "international-address", parts }),
    label,
    parts,
    kind: "address",
  };
}

// ── The port ────────────────────────────────────────────────────────────────

export function smartyAddressLookupPort(
  credentials: SmartyCredentials,
  // Called through a closure rather than passed bare: the Workers runtime refuses a `fetch` detached
  // from the global it belongs to, and fails with an "Illegal invocation" that names nothing useful.
  fetchImplementation: SmartyFetch = (url, init) => fetch(url, init),
): AddressLookupPort {
  const secret = credentialParameters(credentials);

  async function suggest(input: {
    query: string;
    country: string;
    limit?: number;
  }): Promise<SuggestResult> {
    const search = searchFor(input.query);
    // Nothing typed is nothing to ask — and nothing to pay for.
    if (search === "") return suggested([]);
    const country = input.country.trim().toUpperCase();

    if (country === "US") {
      const answer = await request(fetchImplementation, UNITED_STATES_ENDPOINT, {
        ...secret,
        search,
        max_results: offerCount(input.limit),
        // The service would otherwise bias its answers toward the CALLER's location, and the caller
        // is this Worker — an edge data centre that has nothing to do with where the client lives.
        prefer_geolocation: "none",
      });
      return answer.ok ? suggested(unitedStatesOffers(answer.body)) : answer;
    }

    const alphaThree = alphaThreeFor(country);
    if (alphaThree === undefined) return addressCountryNotCovered(country);
    const answer = await request(fetchImplementation, INTERNATIONAL_ENDPOINT, {
      ...secret,
      country: alphaThree,
      search,
      max_results: offerCount(input.limit),
    });
    if (!answer.ok) return answer;
    return suggested(
      listOf(answer.body, "candidates")
        .map((row) => internationalSummaryOffer(row, alphaThree, country))
        .filter((offer): offer is AddressSuggestion => offer !== undefined),
    );
  }

  async function resolve(input: { suggestionId: string }): Promise<ResolveResult> {
    const handle = decodeHandle(input.suggestionId);
    if (handle === undefined) return resolutionExpired();

    switch (handle.route) {
      case "united-states-address":
      case "international-address":
        // The parts travelled with the offer: no request, no charge.
        return resolvedAddress(handle.parts);

      case "united-states-group": {
        const answer = await request(fetchImplementation, UNITED_STATES_ENDPOINT, {
          ...secret,
          search: searchFor(handle.street),
          selected: handle.selected,
          max_results: String(MOST_OFFERS),
          prefer_geolocation: "none",
        });
        if (!answer.ok) return answer;
        const units = unitedStatesOffers(answer.body);
        return units.length === 0 ? resolutionExpired() : resolvedGroup(units);
      }

      case "international": {
        const answer = await request(
          fetchImplementation,
          `${INTERNATIONAL_ENDPOINT}/${encodeURIComponent(handle.identifier)}`,
          { ...secret, country: handle.country },
        );
        if (!answer.ok) return answer;
        const rows = listOf(answer.body, "candidates");
        const alphaTwo = alphaTwoFor(handle.country) ?? "";
        // A detailed row carries a street; a summary row carries an identifier. The service may
        // answer a group with either, so each row is read for what it is.
        const offers = rows
          .map((row) =>
            textOf(row, "street") !== ""
              ? internationalDetailedOffer(row, alphaTwo)
              : internationalSummaryOffer(row, handle.country, alphaTwo),
          )
          .filter((offer): offer is AddressSuggestion => offer !== undefined);
        if (offers.length === 0) return resolutionExpired();
        const only = offers[0];
        return offers.length === 1 && only?.kind === "address"
          ? resolvedAddress(only.parts)
          : resolvedGroup(offers);
      }
    }
    // Every route this adapter mints is handled above; anything else is an offer it does not know.
    return resolutionExpired();
  }

  return { suggest, resolve };
}
