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
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
// One example number per country, 4 KB of it, which is what lets a number field show the grouping
// the country it is set to actually uses rather than the firm's own.
import phoneExamples from "libphonenumber-js/examples.mobile.json";

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

/**
 * A stored number back in the form it was typed in — the country's national grouping.
 *
 * The record keeps the international form (`+17755550148`) because that is what a dialler and a
 * parser want; a person correcting a digit wants the number as they wrote it, grouped the way the
 * field groups it as they type. A number the parser cannot split comes back exactly as stored,
 * which is still the number the person gave.
 */
export function nationalFormOf(stored: string, region: CountryCode): string {
  const parsed = parsePhoneNumberFromString(stored, region);
  return parsed === undefined ? stored : parsed.formatNational();
}

/**
 * Where a country's flag is served from.
 *
 * An `<img>` against a vendored SVG rather than the flag CHARACTER: the regional-indicator pairs are
 * emoji, which this product does not use anywhere (root CLAUDE.md, golden rule 2) and which Windows
 * does not draw at all — a reader there would see two letters in a box where the flag should be. The
 * files are static assets, so a list of two hundred countries costs the bundle nothing and the
 * browser fetches only the rows it draws.
 *
 * THE FILES ARE VENDORED, NOT A DEPENDENCY: `apps/web/static/flags/`, the 3x2 set from
 * country-flag-icons 1.6.20 (MIT, whose LICENSE is beside them), copied in rather than imported so
 * nothing resolves two hundred assets through a bundler at build time or ships them in a chunk.
 * apps/web/test/directory-phone-entry.test.ts asserts a file exists for every country this module
 * offers — a country with no file behind it renders as a broken image, which nothing but opening the
 * list would show.
 */
export function phoneCountryFlag(region: string): string {
  return `/flags/${region}.svg`;
}

/** What a digit reads as in a number field's ghost text. */
const PLACEHOLDER_DIGIT = "X";

/** The shape worked out for a country, kept because it never changes and the list is long. */
const numberPlaceholders = new Map<string, string>();

/**
 * The ghost text for a number field in a given country: the country's own national form with every
 * digit written as an X — `(XXX) XXX-XXXX` in the United States, `XXXXX XXXXXX` in the United
 * Kingdom.
 *
 * This is the ONE placeholder in the product that is not simply its field's name (the rule and its
 * reasoning live in the design system's formatters/placeholder.ts). A number's grouping is not
 * information a person can be given anywhere else: it is what tells them the field expects a
 * national number rather than a `+1` one, and it changes with the country beside it. The shape is
 * derived from libphonenumber's own example number for the country, so it is right for every
 * country rather than right for the firm's own.
 */
export function phoneNumberPlaceholder(region: CountryCode): string {
  const held = numberPlaceholders.get(region);
  if (held !== undefined) return held;
  const example = getExampleNumber(region, phoneExamples);
  const shape =
    example === undefined ? "" : example.formatNational().replaceAll(/\d/g, PLACEHOLDER_DIGIT);
  numberPlaceholders.set(region, shape);
  return shape;
}

/**
 * The field's text after a keystroke, when the keystroke may have been a deletion.
 *
 * A formatter that regroups on every input CANNOT be fed its own output blindly. Backspace over a
 * grouping character deletes a character the formatter puts straight back — `(702) ` becomes
 * `(702)` becomes `(702) ` again — so the key does nothing at all, and the only way to shorten a
 * number is to clear the field and start over. That is what people hit, and it reads as a field
 * that has stopped responding.
 *
 * So a deletion that removed no digit deletes the last DIGIT instead, which is what the person was
 * reaching for. Everything else formats as it always did.
 */
export function formatPhoneAfterEdit(region: CountryCode, previous: string, typed: string): string {
  const digitsBefore = digitsOf(previous);
  const digitsNow = digitsOf(typed);
  const deletedOnlyGrouping =
    typed.length < previous.length && digitsNow === digitsBefore && digitsNow !== "";
  return formatPhoneAsTyped(region, deletedOnlyGrouping ? digitsNow.slice(0, -1) : typed);
}

/** Just the digits, which is what "did this keystroke remove one" is answered against. */
function digitsOf(text: string): string {
  return text.replaceAll(/\D/g, "");
}
