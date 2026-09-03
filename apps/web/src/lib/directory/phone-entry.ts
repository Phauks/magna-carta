/*
 * A telephone or fax number as it is typed and as it is shown.
 *
 * A number carries its country. The field offers the country as a dial code first, then formats
 * the digits as they are typed in that country's own national form, and what is sent to the record
 * is the international form (+1 312 555 0148 as `+13125550148`) with the region beside it, so the
 * server's parser splits the calling code off without guessing. What the record shows is the
 * national form for the firm's own country and the international form for any other, which is how
 * a person in Chicago reads a number in Chicago and a number in London.
 *
 * The formatting knowledge is libphonenumber's, through the memory-safe TypeScript port the
 * workspace already carried; nothing here re-derives a country's grouping rules.
 */
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

export interface PhoneCountry {
  /** The two-letter region code the record stores (`countryRegionCode`). */
  readonly region: CountryCode;
  /** The country's name in the reader's language, or its code where the runtime has no names. */
  readonly name: string;
  /** The dial code, without the plus. */
  readonly callingCode: string;
}

/** The country a number belongs to when nobody chose one. The firm's home; a setting later. */
export const DEFAULT_PHONE_REGION: CountryCode = "US";

let countries: readonly PhoneCountry[] | null = null;

function countryName(region: string): string {
  try {
    const names = new Intl.DisplayNames(undefined, { type: "region" });
    return names.of(region) ?? region;
  } catch {
    return region;
  }
}

/** Every country the formatter knows, named and sorted, the firm's own first. */
export function phoneCountries(): readonly PhoneCountry[] {
  if (countries !== null) return countries;
  const listed = getCountries().map(
    (region): PhoneCountry => ({
      region,
      name: countryName(region),
      callingCode: getCountryCallingCode(region),
    }),
  );
  listed.sort((left, right) =>
    left.region === DEFAULT_PHONE_REGION
      ? -1
      : right.region === DEFAULT_PHONE_REGION
        ? 1
        : left.name.localeCompare(right.name),
  );
  countries = listed;
  return listed;
}

export function phoneCountry(region: string): PhoneCountry | undefined {
  return phoneCountries().find((country) => country.region === region);
}

/** What the country control shows for a country: its dial code and its code, short enough for a row. */
export function phoneCountryShortLabel(country: PhoneCountry): string {
  return `+${country.callingCode} ${country.region}`;
}

/** The field's text after a keystroke: the digits grouped in the country's national form. */
export function formatPhoneAsTyped(region: CountryCode, typed: string): string {
  // AsYouType keeps its own state across inputs; a fresh one per keystroke formats the whole text.
  return new AsYouType(region).input(typed);
}

export type PhoneEntryCheck =
  | {
      readonly ok: true;
      /** The international form the record stores: `+13125550148`. */
      readonly number: string;
      readonly region: CountryCode;
    }
  | { readonly ok: false; readonly reason: string };

/** Whether the typed digits are a number in the chosen country, and what to send when they are. */
export function checkPhoneEntry(region: CountryCode, typed: string): PhoneEntryCheck {
  if (typed.trim() === "") return { ok: false, reason: "The number." };
  const parsed = parsePhoneNumberFromString(typed, region);
  if (parsed === undefined || !parsed.isPossible()) {
    return { ok: false, reason: `Not a number in ${phoneCountry(region)?.name ?? region}.` };
  }
  return { ok: true, number: parsed.number, region: parsed.country ?? region };
}

/**
 * A stored number, shown: national for the firm's own country, international for any other, and
 * exactly as entered where the record could not split it (a number nobody can parse is still a
 * number the person gave).
 */
export function formatStoredPhone(entry: {
  readonly number: string;
  readonly countryRegionCode: string | null;
  readonly extension: string | null;
}): string {
  const parsed = parsePhoneNumberFromString(
    entry.number,
    (entry.countryRegionCode as CountryCode | null) ?? DEFAULT_PHONE_REGION,
  );
  const shown =
    parsed === undefined
      ? entry.number
      : parsed.country === DEFAULT_PHONE_REGION
        ? parsed.formatNational()
        : parsed.formatInternational();
  return entry.extension === null || entry.extension === ""
    ? shown
    : `${shown} ext. ${entry.extension}`;
}
