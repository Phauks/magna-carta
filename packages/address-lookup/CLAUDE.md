# @magna-carta/address-lookup — local notes

The **address autocomplete port and its engine**: the port a surface asks "what addresses match what
this person has typed" through, the deferred implementation that answers honestly while no engine is
provisioned, and the Google Places adapter, the only engine (owner, 2026-11-20; the platform's own US
index and the Smarty adapter were removed then), plus the API contract shapes of the two lookup routes.
Pure package — no `env`, no UI; each adapter's transport is injected, and the Worker decides which port
a request gets.

**Why a port with no engine behind it.** A surface written against `deferredAddressLookupPort()`
degrades to exactly today's behaviour — the person types the address themselves — with no branch at
the call site and no flag to remove later. The day an engine is deployed the only thing that changes
is which port is handed in. Same shape as `resolveSearchIndexPort` in `@magna-carta/search`, and the
same reason.

## Key files / entry points

- `src/port.ts` — `AddressLookupPort`, its inputs and typed outcomes, the smart constructors, and
  `deferredAddressLookupPort()`
- `src/google.ts` — `googleAddressLookupPort(apiKey, fetch)`: Places API (New) Autocomplete and Place
  Details, every country
- `src/contract.ts` — the request and response bodies of `/api/v1/address-lookup/*`, as plain zod
  named with `.meta({ id })`; the route module in `apps/api-worker` declares only the routes
- `src/opaque-handle.ts` — the base64url JSON identifier an adapter mints and decodes

## Invariants that apply here

- **Addresses are fleet-wide reference data, so nothing here takes a firm id.** A discovery split is a
  firm's own content — own bucket, caller-named keys, capability-token read. An address service is the
  same streets for every firm, reached through one platform account. **Do not copy the firm-scoping machinery from `packages/search` into
  an implementation of this port**: there is no tenancy decision to make here, and machinery implying
  one is worse than none.
- **The QUERY is a client's address, even though the service holds nothing of the firm's.** Someone
  typing "14 Rosewood" into a matter is typing a client's home. An implementation therefore keeps no
  log line carrying query text, no cache keyed on it, and nothing between calls. This is the inverse
  of the rule `containers/search` keeps, and it has to be stated in this direction because nothing
  about a shared reference service would suggest it. Sending it to the provider at all is the
  disclosure the owner authorised on 2026-09-20; keeping it out of everything of ours is not optional.
- **`no-coverage` is never folded into an empty result.** An empty `suggestions` means the country is
  covered and nothing matched, which invites a correction. `no-coverage` means the service holds no
  addresses for that country, which invites nothing. Address services cover countries very unevenly,
  so this distinction is load-bearing rather than pedantic.
- **A suggestion is not a verification.** It says a place is known to the address service. It does
  not say mail is deliverable to it today, and a surface must never render it as though it did —
  deliverability is a separate, separately-priced postal-data question, and it belongs in the
  verification columns through a different port.
- **Never a throw.** Every operation answers a typed outcome, so a caller pattern-matches.

## Dependencies & contracts

- One runtime dependency, `zod`, for `src/contract.ts`; the port and the adapter import nothing.
- The postal-code and administrative-area **constraints** are a different package with a different
  job — `@magna-carta/address-formats`, which needs no engine and ships today. Lookup offers
  addresses; formats says what a well-formed one looks like. Neither imports the other.
- `SuggestedAddressParts` restates the international field set rather than importing it. The two
  other places that carry it cannot serve this one: the database's columns are a schema, and the
  design system's `AddressParts` belongs to a Svelte package a Worker must not import. Same reasoning
  as `packages/shipping/src/canonical.ts` stating its own address shape.

## Gotchas

- **`country` is required on a suggest, and that is not an oversight.** The country is already the
  first field of the address form because it decides the rest; an engine guessing it from a fragment
  would offer a street in the wrong hemisphere as confidently as the right one.
- **`suggestionId` is opaque and short-lived.** A caller that parsed one would depend on a detail the
  engine is free to change, and a `resolve` of an id the engine no longer knows answers
  `{ ok: true, resolution: "expired" }` — nothing went wrong, ask again. That is deliberately not a
  failure.
- **A group is not an address.** Every real service answers a building with many units as one line
  with a count. `kind: "group"` says so, and resolving a group answers the addresses inside it rather
  than parts; a surface that wrote a group's line into a record would address a letter to a building
  whose client lives in one of its units.

## The Google adapter

- **The only engine, chosen on the owner's word (trial 2026-11-13, kept 2026-11-20).** Google lets a
  customer keep only its place ID. The adapter returns parts, and the record keeps them; the owner
  chose Google with that explained, and the runbook (operations section 19) records it as open.
- **The key rides in a header and the query in a body**, so neither is in a URL. A failure carries a
  fixed sentence and at most the status code.
- **The field mask is the price.** `DETAILS_FIELD_MASK` names only Essentials-tier fields; one field
  from a higher tier moves every Place Details call to that tier.
- **No groups, no `near`.** Google offers a building as one address and biases by the caller's IP,
  which for a Worker is the edge nearest the person typing. Every offer is `kind: "address"`.
- **A 404 from Place Details is `expired`**, and a handle whose place ID is not Google's alphabet is
  refused before any request, so a forged identifier cannot steer the request path.
- **Attribution is the route's, not the adapter's.** The Worker marks Google's answers
  `attribution: "google-maps"` and the address field shows the name.
