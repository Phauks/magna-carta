# @magna-carta/address-lookup — local notes

The **address autocomplete port and its engines**: the port a surface asks "what addresses match what
this person has typed" through, the deferred implementation that answers honestly while no engine is
provisioned, the self-hosted adapter over the platform's own US index, the Smarty adapter for every
other country, and the routed port that composes them by country. Pure package — no runtime
dependencies, no `env`, no UI; each adapter's transport is injected, and the Worker decides which port
a request gets.

**Why a port with no engine behind it.** A surface written against `deferredAddressLookupPort()`
degrades to exactly today's behaviour — the person types the address themselves — with no branch at
the call site and no flag to remove later. The day an engine is deployed the only thing that changes
is which port is handed in. Same shape as `resolveSearchIndexPort` in `@magna-carta/search`, and the
same reason.

## Key files / entry points

- `src/port.ts` — `AddressLookupPort`, its inputs and typed outcomes, the smart constructors, and
  `deferredAddressLookupPort()`
- `src/smarty.ts` — `smartyAddressLookupPort(credentials, fetch)`: US Autocomplete Pro for the United
  States, International Autocomplete everywhere else
- `src/self-hosted.ts` — `selfHostedAddressLookupPort(binding)`: the port over `apps/address-worker`'s
  `/suggestions` and `/units`, translating the engine's corpus vocabulary into a record's parts
- `src/routed.ts` — `routedAddressLookupPort({ byCountry, otherwise })`: one port over several, with the
  minting engine's name prefixed to every identifier so `resolve` can route
- `src/opaque-handle.ts` — the base64url JSON identifier both adapters mint and decode
- `src/country-alpha-three.ts` — alpha-2 to alpha-3, because the international service alone asks for
  the longer code

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

- No runtime dependencies. `@magna-carta/address-formats` is a DEV dependency only, for the test that
  holds the alpha-3 table against every country the address form publishes a format for.
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

## The Smarty adapter

- **Chosen on storage terms, and that is the constraint to keep.** The address a person picks is
  written into a permanent record. Of the large autocomplete services, one lets a customer store only
  its own place identifier and another treats every result as temporary; Smarty lets the firm keep the
  data, including after cancelling. A replacement provider that forbids storing results is not a
  drop-in, however good its coverage.
- **The credentials ride in the query string**, which is how Smarty authenticates server-side calls.
  So the request URL carries the secret AND the client's address, and it is never quoted — not in a
  failure's `detail`, not in a log. A failure carries a fixed sentence and at most the status code.
- **`prefer_geolocation=none` on every US call.** The default biases answers toward the caller's IP,
  and the caller is a Worker in an edge data centre.
- **Thirty-two characters is the service's ceiling on `search`.** The query is a prefix, so the first
  thirty-two are still the right question.
- **An offer's identifier can hold an address** (a US address carries its own parts, so resolving it
  costs nothing and reaches nobody). It is therefore opaque, travels only in request bodies, and is
  untrusted on the way back: a shape the adapter did not mint answers `expired`, and only the known
  string parts survive a decode.
- **International is two steps, and only the second is charged.** A search returns lines of text and
  identifiers; the parts arrive when somebody chooses one. That is why an international suggestion's
  `parts` holds only the country.

## The self-hosted adapter

- **The engine speaks corpus vocabulary; this adapter is where it becomes a record's.** OpenAddresses
  holds a house number, a street and a unit in capitals. The adapter assembles the street line, puts
  the unit on the second line behind `#` (the corpus does not say whether it is an apartment or a
  suite, and `#` is the designator the postal service accepts for any), and writes street and city in
  the case a person would (`inWrittenCase`). Do that here once, never in a form.
- **`unavailable` from the engine is `engine-not-implemented` here.** The engine is deployed but no
  index has been published yet, which a person experiences exactly like no engine at all.
- **An identifier outlives the index build that minted it.** An address identifier carries its parts
  and coordinates; a group identifier carries its building (number, street, city, region, postcode),
  not a row id. A monthly rebuild between the offer and the choice therefore changes nothing.
- **`near` is a bias, never a filter**, and the engine is what applies it. The adapter forwards it in
  capitals and drops nothing else.

## The routed port

- **Every identifier leaving it is `<engine name>.<engine's identifier>`.** `resolve` has only an
  identifier, so the prefix is the routing. An identifier with no known prefix is `expired`, and no
  engine is asked about it. Engine names are lowercase letters — a name with a `.` in it would split
  wrongly.
- **A country with no engine is `no-coverage`**, not `engine-not-implemented`: some engine is
  provisioned, it just does not cover that country. The Worker returns the bare deferred port, not a
  routed one, when nothing at all is provisioned.
