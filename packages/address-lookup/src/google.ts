/*
 * The Google adapter: AddressLookupPort over Google's Places API (New), Autocomplete and Place Details.
 *
 * WHY IT EXISTS BESIDE THE OTHER TWO. The owner asked on 2026-11-13 to try Google's data first and
 * decide afterwards whether the platform's own index is needed, because Google's addresses are the
 * ones people expect to see. It answers every country, so when its key is set it takes every lookup
 * (apps/api-worker/src/address-lookup/address-lookup-engine.ts).
 *
 * WHAT GOOGLE'S TERMS ASK, AND WHERE EACH IS KEPT. Three things bind any use of this adapter:
 * - Attribution. Places content shown without a Google map carries "Google Maps" in the same visual
 *   container. The suggestions route marks Google's answers so the address field can show it; this
 *   adapter does not render anything.
 * - Storage. Google lets a customer keep a place ID indefinitely and nothing else beyond a short
 *   cache. The parts a person chooses are written into a record, which is the open question the owner
 *   accepted when asking for this trial; it is written down in docs/conventions/operations.md under
 *   the Google section, so whoever turns this into the permanent engine settles it first.
 * - No other map. Google's Places content may not be shown on a non-Google map.
 *
 * TWO REQUESTS, AND ONLY THE SECOND IS AN ADDRESS. Autocomplete answers a line of text and a place
 * ID for each prediction, at most five. Choosing one asks Place Details for that ID with a field mask
 * that stays inside the Essentials price tier (address components, the postal address, the location).
 * There are no session tokens: the address field waits for typing to settle, so a person sends a
 * handful of requests per address, and Google bills the first twelve of a session the same as
 * unsessioned ones when the session ends in an Essentials lookup.
 *
 * GOOGLE HAS NO GROUPS. A building with units is offered as one address, or as the unit somebody
 * typed; every offer here is `kind: "address"`.
 *
 * THE QUERY IS A CLIENT'S ADDRESS. It travels in a request BODY and the key in a header, so neither is
 * in a URL, and no failure carries either: a failure's `detail` is a fixed sentence and at most the
 * status code. Nothing is held between calls.
 *
 * Pure: `fetch` is injected, nothing reads `env`.
 */
import { decodeOpaqueHandle, encodeOpaqueHandle } from "./opaque-handle.ts";
import {
  addressAdapterError,
  resolutionExpired,
  resolvedAddress,
  suggested,
  type AddressLocation,
  type AddressLookupFailure,
  type AddressLookupPort,
  type AddressSuggestion,
  type ResolveResult,
  type SuggestedAddressParts,
  type SuggestResult,
} from "./port.ts";

/** The fetch this adapter calls through — injected so a test never reaches the network. */
export type GoogleFetch = (url: string, init?: RequestInit) => Promise<Response>;

const AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places";

/**
 * Only the fields the adapter reads. Each one is in the Place Details Essentials tier, and naming any
 * field from a higher tier would move the whole request to that tier's price.
 */
export const DETAILS_FIELD_MASK = "addressComponents,postalAddress,location";
const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text";

/** Autocomplete never answers more than five. */
const MOST_OFFERS = 5;

/** As in the Smarty adapter: an answer nobody is waiting for any more is abandoned. */
const REQUEST_TIMEOUT_MILLISECONDS = 4000;

/** A place ID is letters, digits, `-` and `_`. Anything else did not come from Google. */
const PLACE_IDENTIFIER = /^[A-Za-z0-9_-]{1,512}$/u;

// ── Suggestion identifiers ──────────────────────────────────────────────────

/** The place ID and the country asked about, which the details answer may not spell out. */
interface Handle {
  readonly placeIdentifier: string;
  readonly country: string;
}

function decodeHandle(suggestionId: string): Handle | undefined {
  const handle = decodeOpaqueHandle(suggestionId);
  if (handle === undefined) return undefined;
  const { placeIdentifier, country } = handle;
  if (typeof placeIdentifier !== "string" || !PLACE_IDENTIFIER.test(placeIdentifier)) {
    return undefined;
  }
  return typeof country === "string" && /^[A-Z]{2}$/u.test(country)
    ? { placeIdentifier, country }
    : undefined;
}

// ── Talking to the service ──────────────────────────────────────────────────

type Fetched = { readonly ok: true; readonly body: unknown } | AddressLookupFailure;

async function request(
  fetchImplementation: GoogleFetch,
  url: string,
  init: RequestInit,
): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    return addressAdapterError("The address service did not answer in time.");
  }
  if (response.status === 404) return { ok: true, body: undefined };
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

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textOf(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function listOf(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
    : [];
}

function withoutEmpty(parts: Record<string, string>): SuggestedAddressParts {
  return Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== ""));
}

// ── Reading an answer ───────────────────────────────────────────────────────

function offerFrom(
  suggestion: Record<string, unknown>,
  country: string,
): AddressSuggestion | undefined {
  const prediction = recordOf(suggestion["placePrediction"]);
  const placeIdentifier = textOf(prediction, "placeId");
  const label = textOf(recordOf(prediction["text"]), "text");
  if (!PLACE_IDENTIFIER.test(placeIdentifier) || label === "") return undefined;
  return {
    suggestionId: encodeOpaqueHandle({ placeIdentifier, country } satisfies Handle),
    label,
    // Autocomplete holds no parts, only a line of text; the parts arrive when somebody chooses it.
    parts: { country },
    kind: "address",
  };
}

/** One address component's text by type, the short form where Google has one ("CA", not "California"). */
function component(
  components: readonly Record<string, unknown>[],
  type: string,
  form: "longText" | "shortText" = "shortText",
): string {
  const found = components.find((entry) => {
    const types = entry["types"];
    return Array.isArray(types) && types.includes(type);
  });
  if (found === undefined) return "";
  return textOf(found, form) || textOf(found, form === "shortText" ? "longText" : "shortText");
}

/**
 * The postal code, with its extension where Google has one. A United States address answers the
 * five-digit ZIP Code as `postal_code` and the four digits after it as `postal_code_suffix`; the
 * record keeps ZIP+4 written the way the postal service writes it, `12345-6789`, so a letter can
 * carry the full code.
 */
function postalCodeFrom(
  components: readonly Record<string, unknown>[],
  postal: Record<string, unknown>,
): string {
  const code = component(components, "postal_code") || textOf(postal, "postalCode");
  const suffix = component(components, "postal_code_suffix");
  return code !== "" && suffix !== "" && !code.includes("-") ? `${code}-${suffix}` : code;
}

/**
 * The parts a record stores, from a Place Details answer.
 *
 * The street line comes from the postal address Google formats for the country, because the order of
 * a house number and a street differs by country and Google already knows it; the components are the
 * fallback, in the order the United States writes them. The unit goes on the second line behind `#`
 * when Google has one, the designator the US postal service accepts for any kind of unit.
 */
export function partsFromDetails(body: unknown, askedCountry: string): SuggestedAddressParts {
  const place = recordOf(body);
  const components = listOf(place["addressComponents"]);
  const postal = recordOf(place["postalAddress"]);
  const lines = Array.isArray(postal["addressLines"])
    ? postal["addressLines"].filter((line): line is string => typeof line === "string")
    : [];
  const unit = component(components, "subpremise");
  const fromComponents = [component(components, "street_number"), component(components, "route")]
    .filter(Boolean)
    .join(" ");
  const street = (lines[0] ?? "").trim() || fromComponents;
  const lineTwo = (lines[1] ?? "").trim();
  const country = (
    component(components, "country") ||
    textOf(postal, "regionCode") ||
    askedCountry
  ).toUpperCase();

  return withoutEmpty({
    street,
    streetTwo: lineTwo || (unit !== "" && !street.includes(unit) ? `# ${unit}` : ""),
    dependentLocality: component(components, "sublocality", "longText"),
    city:
      component(components, "locality", "longText") ||
      component(components, "postal_town", "longText") ||
      textOf(postal, "locality"),
    region:
      component(components, "administrative_area_level_1") || textOf(postal, "administrativeArea"),
    postal: postalCodeFrom(components, postal),
    sortingCode: textOf(postal, "sortingCode"),
    country,
  });
}

function locationFrom(body: unknown): AddressLocation | undefined {
  const location = recordOf(recordOf(body)["location"]);
  const latitude = location["latitude"];
  const longitude = location["longitude"];
  return typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
    ? { latitude, longitude }
    : undefined;
}

// ── The port ────────────────────────────────────────────────────────────────

export function googleAddressLookupPort(
  apiKey: string,
  // A closure, not the bare global: the Workers runtime refuses a detached `fetch`.
  fetchImplementation: GoogleFetch = (url, init) => fetch(url, init),
): AddressLookupPort {
  const headers = { "content-type": "application/json", "x-goog-api-key": apiKey };

  async function suggest(input: {
    query: string;
    country: string;
    limit?: number;
  }): Promise<SuggestResult> {
    const query = input.query.trim();
    // Nothing typed is nothing to ask, and nothing to pay for.
    if (query === "") return suggested([]);
    const country = input.country.trim().toUpperCase();
    const answer = await request(fetchImplementation, AUTOCOMPLETE_ENDPOINT, {
      method: "POST",
      headers: { ...headers, "x-goog-fieldmask": AUTOCOMPLETE_FIELD_MASK },
      body: JSON.stringify({
        input: query,
        includedRegionCodes: [country.toLowerCase()],
        regionCode: country.toLowerCase(),
      }),
    });
    if (!answer.ok) return answer;
    const wanted = Math.min(MOST_OFFERS, Math.max(1, Math.trunc(input.limit ?? MOST_OFFERS)));
    return suggested(
      listOf(recordOf(answer.body)["suggestions"])
        .map((suggestion) => offerFrom(suggestion, country))
        .filter((offer): offer is AddressSuggestion => offer !== undefined)
        .slice(0, wanted),
    );
  }

  async function resolve(input: { suggestionId: string }): Promise<ResolveResult> {
    const handle = decodeHandle(input.suggestionId);
    if (handle === undefined) return resolutionExpired();
    const answer = await request(
      fetchImplementation,
      `${DETAILS_ENDPOINT}/${encodeURIComponent(handle.placeIdentifier)}`,
      { method: "GET", headers: { ...headers, "x-goog-fieldmask": DETAILS_FIELD_MASK } },
    );
    if (!answer.ok) return answer;
    // A place Google no longer knows is an offer that moved, which the port calls expired.
    if (answer.body === undefined) return resolutionExpired();
    const parts = partsFromDetails(answer.body, handle.country);
    if (parts.street === undefined) return resolutionExpired();
    return resolvedAddress(parts, locationFrom(answer.body));
  }

  return { suggest, resolve };
}
