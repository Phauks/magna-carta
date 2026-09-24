import { ADMINISTRATIVE_AREAS } from "./data-administrative-areas.generated.ts";
import type { AdministrativeArea } from "./types.ts";

/*
 * Which administrative areas a country has — its states, provinces, prefectures, counties, emirates.
 *
 * THIS FILLS THE `region` FIELD, AND THE TWO NAMES MEAN THE SAME THING. The stored column is called
 * `region` because it is named for its POSITION in an address rather than for what any one country
 * calls it; "administrative area" is the address-internationalization corpus's own term for that
 * position. The design system's AddressFields labels it per country — "State", "Province",
 * "Prefecture", "County" — and those words are its to choose, not this package's.
 *
 * A SUGGESTION, NOT A CLOSED CHOICE. Returning a list does not make the field a picker with no way
 * out. Addresses exist in places a published list does not carry — a disputed territory, a region
 * renamed last month, a military post — and an address form that cannot record one records nothing.
 * So a consumer offers these and still accepts what a person types, which is also why an address
 * entered before a list existed keeps whatever value it already holds.
 */

/**
 * The administrative areas of a country, as `{ code, name }`. Empty where the corpus publishes no
 * list — 190 of the 252 countries it carries — which means the field stays free text.
 *
 * `code` is what a record stores and `name` is what a reader sees; for a country that publishes no
 * separate code (Ireland's "Co. Carlow") the two are equal.
 */
export function administrativeAreasFor(country: string | undefined): readonly AdministrativeArea[] {
  if (country === undefined || country === "") return [];
  return ADMINISTRATIVE_AREAS[country.toUpperCase()] ?? [];
}

/**
 * Find one area by the value a record stores. Case-insensitive, because a stored "ca" and a stored
 * "CA" are the same state and a record entered before any list existed chose its own case.
 */
export function administrativeAreaFor(
  country: string | undefined,
  code: string | undefined,
): AdministrativeArea | undefined {
  if (code === undefined || code === "") return undefined;
  const wanted = code.trim().toUpperCase();
  return administrativeAreasFor(country).find((area) => area.code.toUpperCase() === wanted);
}

/** Every country the corpus publishes an administrative-area list for. Sorted, for a stable render. */
export function countriesWithAdministrativeAreas(): readonly string[] {
  return Object.keys(ADMINISTRATIVE_AREAS);
}
