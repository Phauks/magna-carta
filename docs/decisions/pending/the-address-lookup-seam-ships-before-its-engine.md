---
slug: the-address-lookup-seam-ships-before-its-engine
status: Accepted
area: Directory
date: 2026-09-19
summary: "Address autocomplete needs an engine, and the engine is a build rather than a line. So the port ships first and answers honestly: AddressLookupPort has suggest and resolve, returns typed outcomes that never throw, and deferredAddressLookupPort() reports engine-not-implemented to everything — the same wired-but-dormant shape resolveSearchIndexPort takes for the discovery engine, which lets a surface be written once and degrade to exactly today's behaviour with no branch and no flag to remove. Two things about the port are the opposite of the discovery one and are stated loudly because nothing would suggest them: the index is fleet-wide public reference data, so nothing takes a firm id and the firm-scoping machinery must not be copied; and the QUERY is a client's address being typed, so an implementation logs none of it, caches none of it, and holds nothing between calls. no-coverage is a first-class failure because the open corpora cover countries very unevenly, and telling somebody their client's address is wrong when nobody has published that country's addresses is the wrong apology."
---

**The address-lookup seam ships before its engine, and inverts the discovery model in two ways worth
writing down.**

**Context:** entering an address by hand is the state of the product, and autocomplete is the part of
"address lookup" people actually mean. An engine for it is a real build — an index over the open
address corpora, a container to serve it, a worker to own that container — and none of it is a
decision that can be made incrementally at a call site.

**Decision: the port, and a deferred implementation of it.** `@magna-carta/address-lookup` is one
file with no dependencies. `AddressLookupPort` has two operations — offer addresses for what has been
typed (`suggest`), turn a chosen offer into the parts a record stores (`resolve`) — each returning a
typed outcome and never throwing, the discipline `SearchIndexPort` and the integrations `Dispatch`
already keep. `deferredAddressLookupPort()` answers `engine-not-implemented` to everything.

That is the whole reason the seam can ship alone: a surface written against it degrades to exactly
today's behaviour, with no branch at the call site and no flag to remove later, and the day an engine
exists the only thing that changes is which port is handed in.

**The index is fleet-wide reference data, and that inverts the discovery model.** A discovery split
is a firm's own content: it lives in that firm's bucket, the caller names every key, and a read is
guarded by a capability token. An address corpus is the same streets for every firm — one copy, no
firm's data in it, no tenancy decision to make. So nothing in this port takes a firm id, and an
implementation must **not** copy the firm-scoping machinery from `packages/search`. Machinery that
implies a tenancy decision nobody has to make is worse than none: the next reader believes it.

**What does cross is the query, and the query is a client's address.** The index holds nothing of the
firm's, but a person typing "14 Rosewood" into a matter is typing a client's home, and that text
reaches whatever serves this port. An implementation therefore keeps no log line carrying query text,
no cache keyed on it, and nothing between calls. This is the inverse of the rule
`containers/search` keeps about firm content leaving a process, and it has to be stated in this
direction because nothing about a public corpus would suggest it.

**`no-coverage` is a first-class failure, separate from matching nothing.** The open address corpora
cover countries very unevenly — complete land-area coverage for a few dozen, minimal for others — so
an empty result and an uncovered country are different facts. An empty `suggestions` means the
country is covered and nothing matched, which invites a correction. `no-coverage` means nobody has
published that country's addresses, which invites nothing at all. Folding them together tells
somebody their client's address is wrong when the truth is an apology about the data.

**A suggestion is not a verification, and the package says so where an implementer will read it.** An
offer says a place is known to a public corpus. It does not say mail is deliverable there. Open data
knows where a street is and does not know whether mail reaches a unit within it, and that gap is
exactly the licensed postal-data question — delivery-point validation, and the change-of-address
record a court expects to have been checked before it permits substituted service — that no open
corpus answers at any price. That capability lands in the verification columns through a different
port, and conflating the two would put a deliverability claim on an affidavit that cannot carry one.

**The intended engine, recorded so the seam is not mistaken for a provider decision.** An index over
the open address corpora, built offline and range-read out of R2 by a pure-Rust container — reusing
`crates/search-core` and the `HttpRangeReader` that `containers/search` already runs, which is what
keeps the index's size bounded by R2 rather than by the 20 GB a Cloudflare container can hold on
disk. Every query stays inside the tenancy. Nothing here calls out, and no dependency is added.

_Amended 2026-09-20:_ the owner has since authorised an address to leave the tenancy, so a hosted
provider is no longer refused on confidentiality grounds and the two candidate engines compete on
cost and operational surface instead. Nothing in this decision changes — the port was built to be
indifferent to which side wins, which is the property that makes the choice cheap to defer.

**Considered and rejected:** building the engine first and the port with it (the surface then waits
on a container, and the call sites get written twice); a boolean `available` flag instead of a
deferred port (a flag is a branch at every call site and a deletion later, where a deferred port is
neither); folding `no-coverage` into an empty list (tells somebody their address is wrong when the
data is what is missing); inferring the country from the query (the country is already the form's
first field because it decides the rest, and an engine guessing it from a fragment offers a street in
the wrong hemisphere as confidently as the right one); a parseable `suggestionId` (it would make an
index-build detail a contract).

**Consequences:** a surface can be written against address autocomplete today and will answer
honestly until an engine exists. The engine remains unbuilt, and its size and per-query read count
want measuring against `crates/search-eval` before it is committed to.
