import { POSTAL_CODE_FORMATS } from "./data-postal.generated.ts";
import type { PostalCodeVerdict } from "./types.ts";

/*
 * Is this postal code well-formed for the country it is in.
 *
 * A WARNING, NEVER A GATE. The owner settled the shape of this for address verification generally —
 * a failure notifies and never blocks — and the same reasoning binds harder here, because this
 * checks a published FORMAT and not deliverability. A code can match its country's pattern perfectly
 * and reach nobody, and a brand-new development can carry a code no published pattern knows yet.
 * Refusing a save on that is refusing the firm's own record of what a client told them.
 *
 * So every caller of this is expected to render the verdict beside the field and commit regardless.
 */

/**
 * Anchored, case-folded patterns, compiled on first use and kept. The corpus publishes each pattern
 * UNANCHORED, which is the trap this function exists to close: `new RegExp(pattern).test(value)`
 * accepts anything with a valid code buried inside it, so "not a postcode 95014 at all" would pass
 * for the United States. Anchoring is not a nicety, it is the difference between a check and a
 * search.
 */
const compiled = new Map<string, RegExp>();

function patternFor(country: string): RegExp | undefined {
  const held = compiled.get(country);
  if (held !== undefined) return held;
  const format = POSTAL_CODE_FORMATS[country];
  if (format === undefined) return undefined;
  // The corpus is validated at BUILD time (scripts/build-data.mts checks that every pattern compiles
  // and that every published example matches its own pattern), so this cannot throw on committed
  // data — which is exactly why the check lives there rather than in a try/catch here.
  const anchored = new RegExp(`^(?:${format.pattern})$`, "i");
  compiled.set(country, anchored);
  return anchored;
}

/**
 * Check a postal code against its country's published format.
 *
 * `country` is ISO 3166-1 alpha-2; an unknown or absent one answers `no-pattern`. An empty or
 * whitespace-only `value` answers `ok`, because nothing in an address is ever required.
 */
export function validatePostalCode(country: string | undefined, value: string): PostalCodeVerdict {
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "ok" };
  if (country === undefined || country === "") return { kind: "no-pattern" };
  const pattern = patternFor(country.toUpperCase());
  if (pattern === undefined) return { kind: "no-pattern" };
  if (pattern.test(trimmed)) return { kind: "ok" };
  return {
    kind: "malformed",
    examples: POSTAL_CODE_FORMATS[country.toUpperCase()]?.examples ?? [],
  };
}

/**
 * The published format for a country, or undefined where none exists. For a consumer that renders
 * its own input and needs the source pattern; ordinary callers want `validatePostalCode`.
 */
export function postalCodeFormatFor(country: string | undefined) {
  if (country === undefined || country === "") return undefined;
  return POSTAL_CODE_FORMATS[country.toUpperCase()];
}

/** Every country the corpus publishes a postal-code format for. Sorted, for a stable render. */
export function countriesWithPostalCodeFormat(): readonly string[] {
  return Object.keys(POSTAL_CODE_FORMATS);
}

/**
 * The sentence to show under a postal-code box, or null for silence.
 *
 * Here rather than at each call site so the product says the same thing everywhere, and so the
 * wording sits beside the examples it quotes. It names what the country's codes look like instead of
 * printing a pattern: "expected something like 95014 or 22162-1010" is actionable, and a regular
 * expression is not.
 *
 * Silent for an empty value, for a country with no published format, and for a code that matches —
 * so a caller can hand this straight to a field's hint and let it speak only when it has something
 * to say.
 */
export function postalCodeNoteFor(country: string | undefined, value: string): string | null {
  const verdict = validatePostalCode(country, value);
  if (verdict.kind !== "malformed") return null;
  const shown = verdict.examples.slice(0, 2);
  if (shown.length === 0) return "This does not look like a postal code for the chosen country.";
  return `This does not look like a postal code for the chosen country — expected something like ${shown.join(" or ")}.`;
}

/**
 * A postal code as it is being typed, written the way the country's postal service writes it.
 *
 * Today this is the United States alone: nine digits typed without a break are ZIP+4, and the
 * postal service writes them `12345-6789`, so the hyphen goes in as the sixth digit arrives. Without
 * it, a ZIP+4 typed as digits reads as malformed against the country's published pattern and turns
 * the box red for a code that is exactly right. Everything else is returned as typed: a code that
 * already carries a hyphen or a space, a five-digit ZIP Code, and every other country.
 */
export function postalCodeAsTypedFor(country: string | undefined, value: string): string {
  if ((country ?? "").toUpperCase() !== "US") return value;
  const digits = /^(\d{5})(\d{1,4})$/u.exec(value);
  return digits === null ? value : `${digits[1]}-${digits[2]}`;
}
