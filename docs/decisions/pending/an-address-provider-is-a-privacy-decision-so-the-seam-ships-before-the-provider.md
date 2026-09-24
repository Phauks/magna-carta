---
slug: an-address-provider-is-a-privacy-decision-so-the-seam-ships-before-the-provider
status: Superseded — 2026-09-20, by the owner authorising the disclosure
area: Directory
date: 2026-08-30
summary: "The owner asked what a mapping or geocoding provider would buy an address record. It would buy four separable things: deliverability validation, normalization to a canonical postal form, geocoding to coordinates, and a map view. Each is worth a different amount and each carries the same cost, which is that a client's home address leaves the firm's tenancy for a third party — a privacy decision the owner makes explicitly, not a dependency an agent adds. So this pass ships the seam and no provider: the address model is already the international field set with a normalized duplicate key, and a provider result would land in the verification columns that already exist. The recommendation, if one is adopted, is Google's Address Validation API at 17 USD per thousand for coverage plus Smarty for a United States-only firm; the USPS API is free and, since its January 2026 rate limit of sixty lookups an hour and its ban on list validation, is not a platform dependency. Self-hosting Nominatim or Pelias keeps every address inside the tenancy and is the only option with no privacy question at all, at the cost of an operational surface this platform does not otherwise have. libpostal is C and has no pure-Rust port, so golden rule 14 applies to the normalization half."
---

**An address provider is a privacy decision before it is a technical one, so the seam ships and the
provider does not.**

**Context:** the owner's direction was that "addresses would likely do well paired with a mapping API
of some kind for advanced functionality", and asked for a recommendation rather than an adoption. What
such a provider would buy separates into four things that are usually sold together and are worth
different amounts here:

1. **Deliverability validation** — does this address exist and will mail arrive. Worth the most: it is
   the thing that turns a returned envelope from a surprise into something the firm knew about before
   it posted, and service of process is the surface where it matters.
2. **Normalization to a canonical postal form** — "12 High St." and "12 High Street" become one
   string. Worth a lot for duplicate detection and for what an envelope prints.
3. **Geocoding** — coordinates. Worth little today. Nothing in the product asks a question about
   distance; a courthouse-proximity or a travel-time feature would be the thing that made it worth
   something.
4. **A map view** — worth little, and the least separable from a per-render fee.

**The constraint that decides this is not technical.** A client's home address is confidential
information the firm holds in trust. Sending it to a third party is a disclosure, and it is a
disclosure the owner authorises or does not — an agent adding a provider dependency would be making
that call on the firm's behalf. The Workers runtime makes it easy (an outbound fetch) which is exactly
why the decision has to be explicit rather than incidental.

**Decision — for now, the seam and not the provider.** Nothing in this pass calls out, and no
dependency is added. What is built is the shape a provider drops into:

- The address model is already the international field set (recipient, organization, two address
  lines, dependent locality, locality, administrative area, postal code, sorting code, country),
  following the address-internationalization field set rather than a state and a five-digit postal
  code. A provider's structured result maps onto those columns without a migration.
- `normalized_key` is a DUPLICATE-detection key, deliberately not a canonical postal form: it folds
  case, accents and punctuation and nothing else. Canonicalization is what a provider does, and
  pretending to do it badly in-house would produce a key that silently changes meaning the day a real
  one arrives.
- `verification_status` / `verified_at` / `verified_by` / `verification_detail` already exist on the
  row and are exactly where a provider's answer lands. A provider becomes a writer of those four
  columns and changes nothing else.

**What the options actually are, measured.**

| Option | What it buys | Cost | Where the address goes |
| --- | --- | --- | --- |
| **Google Address Validation API** | Validation plus normalization, broad international coverage | 17 USD per 1,000 requests (published April 2026); no free monthly tier documented for this SKU; caching and storage are governed by the Maps Platform terms and must be read before adoption | Google |
| **Smarty** | United States specialist, CASS-certified against the postal service's own data | From 99 USD for 5,000 lookups; volume commitments cut the per-lookup rate substantially | Smarty |
| **Loqate** | Global coverage, and an on-premises option that keeps addresses inside the tenancy | Enterprise procurement; no published per-lookup rate | Loqate, or nowhere, on-premises |
| **USPS Addresses API** | United States validation, free | Free, but since the V3 launch on 25 January 2026 the default is 60 requests an HOUR and the terms permit validation only during label generation, not list or bulk validation | The postal service |
| **Self-hosted Nominatim / Pelias / Photon** | Geocoding and structured lookup over OpenStreetMap and Open Addresses data | No per-lookup fee; a real operational surface — a database, an index, and a data-refresh cadence this platform has nowhere else | Nowhere. Every address stays inside the firm's own infrastructure |

**The recommendation, in order.**

1. **Adopt nothing yet.** No shipped feature is blocked by its absence, and the seam above means
   adopting one later is a writer of four existing columns rather than a migration.
2. **When one is adopted, adopt it for VALIDATION and let it write `verification_status`.** That is
   the half that earns its fee, and it is also the half where the owner's other ruling already
   applies: a failure notifies and never blocks.
3. **For a United States-only firm, Smarty is the better buy** — it is certified against the postal
   service's own data, which is what a deliverability claim on a service affidavit actually rests on.
   **For a firm with any international work, Google's Address Validation API** covers more countries
   for a published per-request rate.
4. **The USPS API is not a platform dependency.** Sixty lookups an hour and a prohibition on list
   validation make it a shipping-label tool, not a directory one.
5. **Self-hosting is the only option with no privacy question at all**, and it is the one to reach for
   if the owner's answer to "may a client's address leave the tenancy" is no. It buys geocoding well
   and validation poorly: open data knows where a street is and does not know whether mail is
   deliverable to a unit within it.

**Golden rule 14 binds the normalization half.** libpostal is the standard address parser and it is a
C library; every Rust crate carrying its name is a binding to that C library, not a port, and there is
no pure-Rust equivalent. Parsing untrusted address strings in C inside a Worker is exactly the shape
the rule exists to refuse, so in-house normalization is not the cheap fallback it looks like — it is
either a hosted provider or a self-hosted service in its own sandbox.

**Considered and rejected:** adding a provider now behind a feature flag (the dependency and the
outbound call are the disclosure, and a flag does not undo either); putting canonicalization into
`normalized_key` in-house (a duplicate key that changes meaning later silently invalidates every
comparison made under the old one); blocking a send on a validation failure (the owner ruled on that
directly: a failure notifies and never blocks); geocoding first because it demos well (nothing in the
product asks a distance question yet, and building the answer before the question is how a per-render
fee arrives with nothing to show for it).

**Consequences:** the firm can record and read every address it holds today, with no third party
involved and no new dependency. A provider becomes a scoped, reversible addition whenever the owner
decides the disclosure is acceptable. The cost of waiting is that duplicate detection catches the same
address entered twice but not the same address entered two ways, and that a returned envelope is
recorded after the fact rather than predicted before the post.
