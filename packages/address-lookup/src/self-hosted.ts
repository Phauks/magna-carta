/*
 * The self-hosted adapter: AddressLookupPort over the platform's own address engine — an index of
 * OpenAddresses built every month into the platform's R2 bucket and read by a Container, reached
 * through apps/address-worker over a service binding.
 *
 * WHY IT EXISTS BESIDE THE SMARTY ADAPTER. The address leaves nothing of ours: the query goes to a
 * Container on the platform's own account, there is no per-lookup bill, no quota and no attribution
 * badge, and the data is the platform's to keep. What it gives up is coverage — the index is the
 * United States only, and its units are thinner than a postal provider's — which is why the two are
 * composed by country rather than one replacing the other (see `routed.ts`).
 *
 * THE ENGINE SPEAKS IN CORPUS VOCABULARY; THIS FILE TRANSLATES. The engine answers a house number, a
 * street, a unit, upper case, the way OpenAddresses holds them. A record stores a street line, a
 * second line, and a city a person would write, so the parts are assembled and cased here, once,
 * rather than in every form.
 *
 * IDENTIFIERS CARRY WHAT RESOLVING NEEDS. An address identifier carries its own parts and coordinates,
 * so choosing one reads nothing and reaches nobody; a group identifier carries its building, so opening
 * it is one request. Neither depends on which index build answered, so an offer made the minute before
 * a monthly rebuild still resolves the minute after it.
 *
 * THE QUERY IS A CLIENT'S ADDRESS. Nothing here logs it and no failure carries it: a failure's `detail`
 * is a fixed sentence and, at most, the engine's status code.
 *
 * Pure: the binding is injected, nothing reads `env`, and nothing is held between calls.
 */
import { decodeOpaqueHandle, encodeOpaqueHandle, partsFrom } from "./opaque-handle.ts";
import {
  addressAdapterError,
  addressCountryNotCovered,
  addressEngineNotImplemented,
  resolutionExpired,
  resolvedAddress,
  resolvedGroup,
  suggested,
  type AddressLocation,
  type AddressLookupFailure,
  type AddressLookupPort,
  type AddressSuggestion,
  type ResolveResult,
  type SuggestedAddressParts,
  type SuggestResult,
} from "./port.ts";

/** The address worker as this adapter needs it: a service binding's `fetch`, or a test's. */
export interface AddressEngineBinding {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * The host is never resolved: a service binding delivers the request to the address worker whatever
 * it names. It is spelled out because a Request needs an absolute URL.
 */
const ENGINE_ORIGIN = "https://address-engine.internal";

/** The engine refuses more than ten, and a list longer than eight is not read while typing. */
const MOST_OFFERS = 10;
const DEFAULT_OFFERS = 8;

/**
 * Nobody waits for an offer for long. A person types past a slow answer within a second or two, so a
 * request still open by then is abandoned rather than allowed to hold the Worker.
 */
const REQUEST_TIMEOUT_MILLISECONDS = 4000;

/** What the engine says about one address. */
interface EngineAddress {
  readonly number: string;
  readonly street: string;
  readonly unit: string;
  readonly city: string;
  readonly region: string;
  readonly postcode: string;
  readonly longitude: number;
  readonly latitude: number;
}

/** What the engine says identifies a building: everything its units share. */
interface EngineBuilding {
  readonly number: string;
  readonly street: string;
  readonly city: string;
  readonly region: string;
  readonly postcode: string;
}

type Handle =
  | {
      readonly route: "address";
      readonly parts: SuggestedAddressParts;
      readonly location?: AddressLocation;
    }
  | { readonly route: "building"; readonly country: string; readonly building: EngineBuilding };

// ── Casing ──────────────────────────────────────────────────────────────────

/**
 * Words that stay in capitals: compass points and the highway designations a street line carries
 * ("US 401", "SR 20", "FM 1960"), plus Roman numerals in a name.
 */
const KEPT_IN_CAPITALS = new Set([
  "N",
  "S",
  "E",
  "W",
  "NE",
  "NW",
  "SE",
  "SW",
  "US",
  "SR",
  "CR",
  "FM",
  "RR",
  "HC",
  "PO",
  "II",
  "III",
  "IV",
]);

/**
 * "LAWSON CREEK WAY" to "Lawson Creek Way", the way a person writes it. An ordinal keeps its digits
 * and lowers its suffix ("1ST" to "1st"); any other word with a digit in it is left alone, because a
 * unit or a route number ("4B", "I-40") is not a word with a case to correct.
 */
export function inWrittenCase(text: string): string {
  return text
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => {
      if (/^\d+(ST|ND|RD|TH)$/u.test(word)) return word.toLowerCase();
      if (/\d/u.test(word) || KEPT_IN_CAPITALS.has(word)) return word;
      return word
        .toLowerCase()
        .replace(/(^|[-'])(\p{L})/gu, (_, boundary: string, letter: string) => {
          return boundary + letter.toUpperCase();
        });
    })
    .join(" ");
}

// ── Translation ─────────────────────────────────────────────────────────────

function textOf(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function coordinateOf(value: Record<string, unknown>, key: string, bound: number): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) && Math.abs(field) <= bound
    ? field
    : null;
}

function engineAddressFrom(value: unknown): EngineAddress | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const number = textOf(row, "number");
  const street = textOf(row, "street");
  const longitude = coordinateOf(row, "longitude", 180);
  const latitude = coordinateOf(row, "latitude", 90);
  if (number === "" || street === "" || longitude === null || latitude === null) return undefined;
  return {
    number,
    street,
    unit: textOf(row, "unit"),
    city: textOf(row, "city"),
    region: textOf(row, "region"),
    postcode: textOf(row, "postcode"),
    longitude,
    latitude,
  };
}

function engineBuildingFrom(value: unknown): EngineBuilding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const building = {
    number: textOf(row, "number"),
    street: textOf(row, "street"),
    city: textOf(row, "city"),
    region: textOf(row, "region"),
    postcode: textOf(row, "postcode"),
  };
  return building.number === "" || building.street === "" ? undefined : building;
}

function withoutEmpty(parts: Record<string, string>): SuggestedAddressParts {
  return Object.fromEntries(Object.entries(parts).filter(([, part]) => part !== ""));
}

/**
 * The parts a record stores. The unit goes on the second line behind "#", the secondary designator
 * the postal service accepts for any kind of unit — the corpus records the unit's number and not
 * whether it is an apartment, a suite or a lot, and guessing one would be wrong for the others.
 */
function buildingParts(building: EngineBuilding, country: string): SuggestedAddressParts {
  return withoutEmpty({
    street: inWrittenCase(`${building.number} ${building.street}`),
    city: inWrittenCase(building.city),
    region: building.region,
    postal: building.postcode,
    country,
  });
}

function addressParts(address: EngineAddress, country: string): SuggestedAddressParts {
  return withoutEmpty({
    street: inWrittenCase(`${address.number} ${address.street}`),
    streetTwo: address.unit === "" ? "" : `#${address.unit}`,
    city: inWrittenCase(address.city),
    region: address.region,
    postal: address.postcode,
    country,
  });
}

/** One line, as a person reads an address in a list: street, unit, city, region and code. */
function labelOf(parts: SuggestedAddressParts): string {
  const street = [parts.street, parts.streetTwo].filter(Boolean).join(" ");
  const regionAndCode = [parts.region, parts.postal].filter(Boolean).join(" ");
  return [street, parts.city, regionAndCode].filter(Boolean).join(", ");
}

function addressSuggestion(address: EngineAddress, country: string): AddressSuggestion {
  const parts = addressParts(address, country);
  const location = { latitude: address.latitude, longitude: address.longitude };
  return {
    suggestionId: encodeOpaqueHandle({ route: "address", parts, location } satisfies Handle),
    label: labelOf(parts),
    parts,
    kind: "address",
  };
}

function groupSuggestion(
  building: EngineBuilding,
  count: number | undefined,
  country: string,
): AddressSuggestion {
  const parts = buildingParts(building, country);
  return {
    suggestionId: encodeOpaqueHandle({ route: "building", country, building } satisfies Handle),
    label: labelOf(parts),
    parts,
    kind: "group",
    ...(count !== undefined && { count }),
  };
}

function offersFrom(value: unknown, country: string): readonly AddressSuggestion[] {
  if (!Array.isArray(value)) return [];
  const offers: AddressSuggestion[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const offer = entry as Record<string, unknown>;
    if (offer.kind === "address") {
      const address = engineAddressFrom(offer.address);
      if (address !== undefined) offers.push(addressSuggestion(address, country));
    } else if (offer.kind === "group") {
      const building = engineBuildingFrom(offer.building);
      const count =
        typeof offer.count === "number" && Number.isInteger(offer.count) && offer.count > 0
          ? offer.count
          : undefined;
      if (building !== undefined) offers.push(groupSuggestion(building, count, country));
    }
  }
  return offers;
}

function decodeHandle(identifier: string): Handle | undefined {
  const handle = decodeOpaqueHandle(identifier);
  if (handle === undefined) return undefined;
  if (handle.route === "address") {
    const parts = partsFrom(handle.parts);
    if (parts === undefined) return undefined;
    const location =
      typeof handle.location === "object" && handle.location !== null
        ? (handle.location as Record<string, unknown>)
        : undefined;
    const latitude = location === undefined ? null : coordinateOf(location, "latitude", 90);
    const longitude = location === undefined ? null : coordinateOf(location, "longitude", 180);
    return latitude === null || longitude === null
      ? { route: "address", parts }
      : { route: "address", parts, location: { latitude, longitude } };
  }
  if (handle.route === "building" && typeof handle.country === "string") {
    const building = engineBuildingFrom(handle.building);
    return building === undefined
      ? undefined
      : { route: "building", country: handle.country, building };
  }
  return undefined;
}

// ── Talking to the engine ───────────────────────────────────────────────────

type Answered =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | AddressLookupFailure;

/**
 * One request, and a failure that says what happened without saying what was asked: a fixed sentence
 * and, where there is one, the engine's status code.
 */
async function ask(
  engine: AddressEngineBinding,
  operation: "/suggestions" | "/units",
  body: unknown,
): Promise<Answered> {
  let response: Response;
  try {
    response = await engine.fetch(`${ENGINE_ORIGIN}${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    return addressAdapterError("The address engine did not answer in time.");
  }
  if (!response.ok) {
    return addressAdapterError(`The address engine refused the request (${response.status}).`);
  }
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed !== "object" || parsed === null) {
      return addressAdapterError(
        "The address engine answered in a shape this adapter does not read.",
      );
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return addressAdapterError("The address engine answered with something that is not JSON.");
  }
}

/** The two answers every engine operation may give instead of its own. */
function sharedOutcome(
  body: Record<string, unknown>,
  country: string,
): AddressLookupFailure | null {
  if (body.outcome === "no-coverage") return addressCountryNotCovered(country);
  // No index has been built yet: the engine is deployed but has nothing to answer from, which the
  // form reads exactly as it reads an engine that is not deployed at all.
  if (body.outcome === "unavailable") return addressEngineNotImplemented();
  return null;
}

/**
 * The engine's index holds US states, which are two letters, and refuses any other bias. A bias is a
 * nicety, so one the engine cannot use is dropped here rather than allowed to refuse the request.
 */
function biasRegionOf(near: string | undefined): string | undefined {
  const region = near?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/u.test(region) ? region : undefined;
}

export function selfHostedAddressLookupPort(engine: AddressEngineBinding): AddressLookupPort {
  return {
    async suggest(input): Promise<SuggestResult> {
      const country = input.country.toUpperCase();
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_OFFERS, 1), MOST_OFFERS);
      const answer = await ask(engine, "/suggestions", {
        country,
        query: input.query,
        limit,
        ...(biasRegionOf(input.near) !== undefined && { near: biasRegionOf(input.near) }),
      });
      if (!answer.ok) return answer;
      const shared = sharedOutcome(answer.body, country);
      if (shared !== null) return shared;
      if (answer.body.outcome !== "suggestions") {
        return addressAdapterError(
          "The address engine answered in a shape this adapter does not read.",
        );
      }
      return suggested(offersFrom(answer.body.offers, country).slice(0, limit));
    },

    async resolve(input): Promise<ResolveResult> {
      const handle = decodeHandle(input.suggestionId);
      if (handle === undefined) return resolutionExpired();
      if (handle.route === "address") return resolvedAddress(handle.parts, handle.location);

      const answer = await ask(engine, "/units", {
        country: handle.country,
        building: handle.building,
      });
      if (!answer.ok) return answer;
      const shared = sharedOutcome(answer.body, handle.country);
      if (shared !== null) return shared;
      if (answer.body.outcome !== "units" || !Array.isArray(answer.body.addresses)) {
        return addressAdapterError(
          "The address engine answered in a shape this adapter does not read.",
        );
      }
      const units = (answer.body.addresses as unknown[])
        .map(engineAddressFrom)
        .filter((address): address is EngineAddress => address !== undefined)
        .map((address) => addressSuggestion(address, handle.country));
      // A building whose units have all gone since the offer was made is an offer the engine no
      // longer knows, not an empty building.
      return units.length === 0 ? resolutionExpired() : resolvedGroup(units);
    },
  };
}
