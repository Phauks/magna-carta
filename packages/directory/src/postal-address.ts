/*
 * The postal-address field set, and the key that spots the same address recorded twice.
 *
 * THE FIELD SET IS INTERNATIONAL AND THE ORDER IS THE COUNTRY'S. Which fields a country's addresses
 * use, what a reader there calls them and what order they read in are all properties of the country,
 * not of the platform: Ireland has no state, Japan writes the postal code first and reads from the
 * largest unit down, Brazil carries a neighbourhood line, the United Kingdom's postal code is
 * alphanumeric and its "county" is optional and shrinking. So the stored fields are named for their
 * POSITION in an address rather than for what one country calls them, and the labels and order a
 * screen shows are a function of the chosen country.
 *
 * Nothing here hard-codes a state and a five-digit postal code, and nothing requires a field: an
 * address a firm holds only half of is still the address it holds, and refusing to store it sends it
 * into a free-text note where no envelope, no service affidavit and no duplicate check can reach it.
 */

/** The address as its parts, in the order an address is written. Every part optional. */
export interface PostalAddressParts {
  /** The addressee line, where it differs from the name of the entity the address belongs to. */
  readonly recipient?: string | null;
  /** The care-of organization line. */
  readonly organizationName?: string | null;
  /** First address line — in most countries the street and number. */
  readonly street?: string | null;
  /** Second address line — a suite, a unit, a floor, a building name. */
  readonly streetTwo?: string | null;
  /** Neighbourhood, district, suburb or county, where the country uses one. */
  readonly dependentLocality?: string | null;
  /** The locality: city, town, village. */
  readonly city?: string | null;
  /** The administrative area: state, province, prefecture, county — where the country has one. */
  readonly region?: string | null;
  /** The postal code, in whatever form the country writes it. Never assumed numeric. */
  readonly postal?: string | null;
  /** The sorting code — France's CEDEX and its equivalents. */
  readonly sortingCode?: string | null;
  /** ISO 3166-1 alpha-2. The field that decides what every field above is called and where it sits. */
  readonly country?: string | null;
}

/** Thrown when every part of an address is empty. A row with nothing in it is not an address. */
export class EmptyPostalAddressError extends Error {
  readonly code = "empty-postal-address";
  constructor() {
    super("directory: a postal address must carry at least one part (empty-postal-address)");
    this.name = "EmptyPostalAddressError";
  }
}

/** Trim, and treat a whitespace-only value as absent so a blank field never becomes a stored space. */
export function trimmedPart(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// The parts that make up the address itself, in reading order. Recipient and organization are
// deliberately absent: two people at one company share an address, and folding the addressee into
// the key would report two rows as different addresses when they are the same place.
function addressBodyParts(parts: PostalAddressParts): readonly (string | null)[] {
  return [
    trimmedPart(parts.street),
    trimmedPart(parts.streetTwo),
    trimmedPart(parts.dependentLocality),
    trimmedPart(parts.city),
    trimmedPart(parts.region),
    trimmedPart(parts.postal),
    trimmedPart(parts.sortingCode),
    trimmedPart(parts.country),
  ];
}

/** True when nothing at all was supplied — not one line, not even a country. */
export function postalAddressIsEmpty(parts: PostalAddressParts): boolean {
  return (
    addressBodyParts(parts).every((part) => part === null) &&
    trimmedPart(parts.recipient) === null &&
    trimmedPart(parts.organizationName) === null
  );
}

/**
 * The duplicate-detection key for one address — the counterpart of the normalized address the email
 * table already carries.
 *
 * Case-folded, diacritic-stripped and punctuation-stripped, with the parts joined by a separator so
 * that a value crossing a field boundary cannot make two different addresses collide: `"12 High
 * St" / "Ayr"` and `"12" / "High St Ayr"` are different records and stay different keys.
 *
 * It is a DUPLICATE key and not a canonical postal form. Nothing here abbreviates Street to St or
 * decides that Apartment and Unit are the same word — that is postal normalization, it is
 * country-specific, and it is what an address-verification provider is for. This catches the same
 * address entered twice, which is the case a record screen actually meets.
 */
export function normalizedAddressKey(parts: PostalAddressParts): string {
  return addressBodyParts(parts)
    .map((part) =>
      part === null
        ? ""
        : part
            .normalize("NFKD")
            .replaceAll(/\p{Diacritic}/gu, "")
            .toLowerCase()
            .replaceAll(/[^\p{Letter}\p{Number}]+/gu, " ")
            .trim(),
    )
    .join("|");
}
