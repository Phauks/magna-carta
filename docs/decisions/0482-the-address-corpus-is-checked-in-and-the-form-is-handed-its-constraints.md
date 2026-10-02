---
number: 482
slug: the-address-corpus-is-checked-in-and-the-form-is-handed-its-constraints
status: Accepted
date: 2026-09-19
area: Directory
summary: "The one address form could not say a postal code read wrong or offer a state, because the per-country table it renders from is a curated shape rather than a reference dataset, and the design system depends on exactly one workspace package by design. So the constraints become their own dependency-free package, @magna-carta/address-formats, and reach the component as optional props the way the country list already does — 252 countries projected from the address-internationalization corpus into 182 postal-code formats and 62 administrative-area lists. The corpus is CHECKED IN and refreshed by a deliberate act rather than fetched at build time, because a build that reached a live service would depend on a third party being up and could change a postal rule under a release nobody made. A malformed code renders as the field's hint and never its error: the box is never marked invalid, and nothing here can refuse a commit. The administrative-area list is offered through a native datalist rather than a combobox, because the region field is not a closed choice."
---

**The address corpus is checked in, and the form is handed its constraints rather than importing them.**

**Context:** `AddressFields` has been the product's one address form since the directory landed, and
its per-country table is deliberately a curated SHAPE — which boxes a country uses, what a reader
there calls each one, what order they read in. What it has never carried is CONSTRAINT: no
postal-code patterns and no administrative-area lists, so the form could not tell somebody a code
read wrong and could not offer them a state. The feature ledger has carried that as the node's open
question since it shipped, with "adopting the address-metadata corpus" named as the option and a
monthly-staleness cost attached to it.

**The constraint that shaped the answer is a dependency rule, not a data one.**
`packages/design-system` links exactly one workspace package (`@magna-carta/design-tokens`), and
`AddressFields` is documented as domain-blind: it takes the parts, the country and the list of
countries to offer, and hands back the parts. Importing a corpus into it would end that, and would
end it for every consumer of the design system rather than for the two screens that enter addresses.

**Decision — three parts.**

1. **The constraints are their own package, and the component is HANDED them.**
   `@magna-carta/address-formats` has no workspace dependencies at all. `AddressFields` gains two
   optional props, `administrativeAreas` and `postalCodeNote`, which is the same shape the `countries`
   prop has taken since the component was written. The app wires the two together; neither imports
   the other, and a story satisfies the contract with four lines of fixture — which is the contract
   working rather than a convenience.

2. **The corpus is checked in, and refreshing it is a deliberate, reviewable act.** A generator that
   fetched the address-internationalization service at build time would make every build depend on a
   third party being up, and would let a country's postal rule change under a release nobody made.
   `fetch-corpus.mts` writes `docs/research/address-formats/corpus.json`, the diff is read, and the
   commit is the decision. `build-data.mts` projects it and **validates it**: every pattern must
   compile anchored and every published example must match its own pattern, so a bad corpus breaks
   the build where a person is reading output rather than the address form where it would quietly
   refuse a postcode that is correct. `--check` is the drift guard the gate runs.

3. **A malformed code is the field's HINT, never its error.** It renders through `LabelledField`'s
   hint slot, so `aria-invalid` is never set and nothing here can refuse a commit. This follows the
   owner's standing ruling that a failed address verification notifies and never blocks, and the
   reasoning binds harder here: this checks a published FORMAT, not deliverability. A code can match
   its country's pattern perfectly and reach nobody, and a new development can carry one no published
   pattern knows yet.

**"No published format" is a different answer from "wrong", and the type says so.** Seventy of the
252 countries operate no postal-code system or publish no format. Rendering that as a failure would
tell somebody their address is malformed when the truth is that their country does not do postal
codes, so `validatePostalCode` answers `no-pattern`, and a caller shows nothing.

**The patterns are published UNANCHORED, which is the trap worth writing down.**
`new RegExp(pattern).test(value)` accepts anything with a valid code buried inside it — "not a
postcode 95014 at all" passes for the United States. Anchoring is the difference between a check and
a search, and it is held by a test asserting exactly that string is malformed.

**A datalist, not a combobox, for the region.** The standing rule that every closed choice is a
combobox is about choices with a known, complete set of answers; the region field has neither.
Addresses exist in places a published list does not carry — a territory in dispute, a region renamed
last month, a military post — and a record entered before any list existed already holds whatever
somebody typed. A combobox settles its box back onto a listed value on close, which would silently
destroy exactly those. A datalist offers the list and keeps the typing. The honest limit is that a
datalist filters on the option's value, which is the stored code, so typing a state's full name may
narrow to nothing in some browsers; nothing is lost when it does, and storing the code is what an
envelope prints.

**The two generated modules are separate on purpose.** Administrative areas are ~114 KB and postal
formats ~15 KB. A consumer that only validates a code should not carry every state and prefecture to
do it, and keeping them as different modules is what lets the larger half be imported dynamically
later without moving an export.

**Two findings in the pending provider decision are now out of date, and this records the
correction.** That decision (an address provider is a privacy decision, so the seam ships before the
provider) still stands — no provider is adopted here and nothing calls out. But it says Google's
Address Validation API documents no free monthly tier, and the published pricing now carries 5,000
free requests a month before the 17 USD per 1,000 rate. And it rules self-hosting out partly because
it "adds an operational surface this platform does not otherwise have" — which was true when it was
written and is not now: `containers/search` runs a pure-Rust Tantivy engine that range-reads its
index out of R2 rather than holding it on disk, so a large read-only index is a shape this platform
already operates. That matters because the off-the-shelf geocoders remain impossible here for a
different and harder reason — Nominatim wants roughly 1 TB of disk and 128 GB of RAM against a
Cloudflare Containers ceiling of 20 GB and 12 GiB — while a purpose-built index is not.

**Considered and rejected:** importing the corpus into the design system (ends the component's one
dependency, for every consumer, to serve two screens); fetching at build time (a build that depends
on a third party, and a rule that changes under a release nobody made); refusing a commit on a
malformed code (the owner ruled on the general case, and a format check is a weaker signal than the
verification that ruling was about); a combobox for the region (destroys an unlisted value on close);
one generated module (makes a consumer that validates a postcode carry 1,619 administrative areas);
deriving the country list here (it is the phone field's list, so a record's address and its number
never offer different sets of countries — one home, and this package supplies no country names).

**Consequences:** the address form can now say a postal code reads wrong in 182 countries and offer
administrative areas in 62, with no network call, no per-lookup fee, no third party, and no address
leaving the firm's tenancy. The ledger node's open question is closed. What this does not buy is
deliverability: a code can be well-formed and undeliverable, and nothing here knows the difference.
