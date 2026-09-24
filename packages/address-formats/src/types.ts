/*
 * What a country's address CONSTRAINTS are — the contract. The populated data is generated
 * (data-postal.generated.ts, data-administrative-areas.generated.ts); this file is what they promise.
 *
 * THIS PACKAGE IS CONSTRAINT, NOT SHAPE, AND THE TWO HAVE DIFFERENT HOMES. Which boxes an address
 * form shows, what a reader there calls each one and what order they read in is the design system's
 * (packages/design-system/src/lib/components/address-fields/address-format.ts) — a presentation
 * choice, and the reason that file can be a table of formats rather than a schema. What is here is
 * the other half: what a postal code in that country LOOKS like, and which administrative areas
 * exist. A form can render without it; a form cannot tell you that a postcode is malformed without it.
 *
 * NOTHING HERE MAKES A FIELD REQUIRED. A constraint says what a well-formed value looks like when one
 * is given, never that one must be. An address a firm holds half of is still the address it holds,
 * and the form that refuses it sends it into a free-text note where no envelope and no affidavit of
 * service can reach it. Every function here answers `ok` for an empty value, deliberately.
 */

/** One administrative area — a state, province, prefecture, county, or emirate. */
export interface AdministrativeArea {
  /**
   * The value a record STORES. For the United States that is the postal abbreviation ("CA"); for
   * Ireland it is the name itself ("Co. Carlow"), because Ireland publishes no separate code. It is
   * whatever the address-internationalization corpus lists as the storable key, never a code this
   * package invents.
   */
  readonly code: string;
  /** What a reader sees. Equal to `code` where a country publishes no separate display name. */
  readonly name: string;
}

/** What a well-formed postal code looks like in one country. */
export interface PostalCodeFormat {
  /**
   * The pattern, as the corpus publishes it and UNANCHORED. Callers must not use it raw — matching is
   * `validatePostalCode`, which anchors it and folds case. It is exposed because a consumer that
   * renders its own input (a native form, a generated client) needs the source pattern.
   */
  readonly pattern: string;
  /**
   * Real codes from that country, for the message shown when one does not match. A refusal that says
   * "expected 95014 or 22162-1010" is actionable; one that prints a regular expression is not.
   */
  readonly examples: readonly string[];
}

/** What `validatePostalCode` found. Never a throw, and never a boolean — "we hold no rule for this
 * country" and "this code is wrong" send a person to different places. */
export type PostalCodeVerdict =
  /** Well-formed, or empty, or the country uses no postal code at all. */
  | { readonly kind: "ok" }
  /**
   * The corpus holds no pattern for this country — 70 of the 252 it carries, because they operate no
   * postal-code system or publish no format. NOT a failure: it is the honest answer, and a caller
   * shows nothing rather than inventing a rule.
   */
  | { readonly kind: "no-pattern" }
  /** The value does not match the country's published format. Carries examples to show. */
  | { readonly kind: "malformed"; readonly examples: readonly string[] };
