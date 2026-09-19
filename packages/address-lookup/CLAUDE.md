# @magna-carta/address-lookup — local notes

The **address autocomplete seam**: the port a surface asks "what addresses match what this person has
typed" through, and the deferred implementation that answers honestly until an engine exists. Pure
package — one file, no dependencies, no network, no `env`, no UI. The engine itself is not built.

**Why a port with no engine behind it.** A surface written against `deferredAddressLookupPort()`
degrades to exactly today's behaviour — the person types the address themselves — with no branch at
the call site and no flag to remove later. The day an engine is deployed the only thing that changes
is which port is handed in. Same shape as `resolveSearchIndexPort` in `@magna-carta/search`, and the
same reason.

## Key files / entry points

- `src/port.ts` — the whole package: `AddressLookupPort`, its inputs and typed outcomes, the smart
  constructors, and `deferredAddressLookupPort()`

## Invariants that apply here

- **The index is fleet-wide reference data, so nothing here takes a firm id.** A discovery split is a
  firm's own content — own bucket, caller-named keys, capability-token read. An address corpus is the
  same streets for every firm. **Do not copy the firm-scoping machinery from `packages/search` into
  an implementation of this port**: there is no tenancy decision to make here, and machinery implying
  one is worse than none.
- **The QUERY is a client's address, even though the index holds nothing of the firm's.** Someone
  typing "14 Rosewood" into a matter is typing a client's home. An implementation therefore keeps no
  log line carrying query text, no cache keyed on it, and nothing between calls. This is the inverse
  of the rule `containers/search` keeps, and it has to be stated in this direction because nothing
  about a public corpus would suggest it.
- **`no-coverage` is never folded into an empty result.** An empty `suggestions` means the country is
  covered and nothing matched, which invites a correction. `no-coverage` means nobody has published
  that country's addresses, which invites nothing. The open corpora cover countries very unevenly, so
  this distinction is load-bearing rather than pedantic.
- **A suggestion is not a verification.** It says a place is known to a public corpus. It does not
  say mail is deliverable there, and a surface must never render it as though it did — deliverability
  is a licensed postal-data question no open corpus answers, and it belongs in the verification
  columns through a different port.
- **Never a throw.** Every operation answers a typed outcome, so a caller pattern-matches.

## Dependencies & contracts

- None. Deliberately: this is the seam, and a seam that dragged a dependency in would be a decision
  rather than a shape.
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
  next index build is free to change, and a `resolve` of an id the engine no longer knows answers
  `{ ok: true, parts: undefined }` — the offer expired, nothing went wrong, ask again. That is
  deliberately not a failure.
