# @magna-carta/address-formats — local notes

The postal-code and administrative-area **constraints** behind the product's one address form: what a
well-formed postal code looks like in a country, and which states, provinces, prefectures or counties
that country publishes. Pure data plus three lookups — no network, no credentials, no `env`, no UI,
and no dependency on any other workspace package.

**This package is CONSTRAINT. The design system owns SHAPE.** Which boxes an address form shows, what
a reader there calls each one and what order they read in is
`packages/design-system/src/lib/components/address-fields/address-format.ts` — a presentation choice,
and the reason that file is a table of formats rather than a schema. Keeping the words here too would
be a second home for the same fact, so the generator drops them on purpose.

## Key files / entry points

- `src/postal-code.ts` — `validatePostalCode` / `postalCodeFormatFor` / `countriesWithPostalCodeFormat`
- `src/administrative-areas.ts` — `administrativeAreasFor` / `administrativeAreaFor`
- `src/types.ts` — the contract the two generated modules promise
- `src/data-postal.generated.ts`, `src/data-administrative-areas.generated.ts` — **generated, never
  hand-edited**
- `scripts/fetch-corpus.mts` — refreshes the corpus from the address-internationalization service
- `scripts/build-data.mts` — projects the corpus into the two modules; `--check` is the drift guard

## Invariants that apply here

- **Nothing is ever required.** Every function answers `ok`/empty for an absent value. A constraint
  says what a well-formed value looks like when one is given, never that one must be given. An
  address a firm holds half of is still the address it holds.
- **A warning, never a gate.** A malformed postal code is reported beside the field and the record
  saves. A code can match its country's pattern perfectly and reach nobody, and a new development can
  carry a code no published pattern knows yet — the same reasoning as the owner's ruling that a
  failed address verification notifies and never blocks.
- **"No rule" and "wrong" are different answers.** `no-pattern` is the honest outcome for the 70
  countries that publish no postal format, and it must never be rendered as a failure.
- **An administrative-area list is a SUGGESTION.** Returning one never closes the field. Addresses
  exist in places a published list does not carry, and a record entered before a list existed keeps
  whatever value it already holds.

## Dependencies & contracts

- No workspace dependencies at all, deliberately: the design system takes this data as **props**
  (`packages/design-system/package.json` links exactly one workspace package, and `AddressFields` is
  documented as domain-blind). A consumer wires the two together; neither imports the other.
- The country LIST is not here. It is the phone field's list in
  `apps/web/src/lib/directory/phone-entry.ts`, so a record's address and its number never offer
  different sets of countries. This package is keyed by country code and supplies no names of its own.

## Gotchas

- **The corpus publishes every pattern UNANCHORED.** `new RegExp(pattern).test(value)` therefore
  accepts anything with a valid code buried inside it — "not a postcode 95014 at all" passes for the
  United States. `validatePostalCode` anchors and case-folds; nothing else should compile a raw
  pattern. Held by a test that asserts exactly that string is malformed.
- **The corpus is checked in, and the fetch is a deliberate act.** `fetch-corpus.mts` hits a live
  service; a build that fetched would depend on a third party being up and could change a postal rule
  under a release nobody made. Refresh when a country is reported wrong, read the diff, commit it.
- **`build:data` validates as well as renders.** Every pattern must compile anchored and every
  published example must match its own pattern, so a bad corpus breaks the build rather than the
  address form. The same invariant is asserted in the test battery, which is what stops a
  hand-edited generated file passing.
- **The two generated modules are separate on purpose.** Administrative areas are ~114 KB and postal
  formats ~15 KB; a consumer that only validates a code should not carry every state and prefecture
  to do it. That split is what lets the larger half be imported dynamically later without moving an
  export.
- `code` is what a record stores and `name` is what a reader sees, and for a country publishing no
  separate code (Ireland's "Co. Carlow") the two are equal — so never assume `code` is an abbreviation.
