---
number: 369
slug: a-feature-whose-boundary-is-unproven-ships-without-the-part-that-needs-it
status: Proposed
date: 2026-08-16
area: Core domain
summary: "Natural-language document search is built and merged with every gate closed and the retrieval route deliberately absent, splitting the feature at the line where evidence runs out rather than where the work does. Everything that does not expose a query surface ships: the consent gate behind a firm-level versioned disclosure whose acceptance the write path refuses without, the per-matter exclusion that deletes rather than stops, the derived text feed written as a second consumer of the extraction the search index job already performs, the instance lifecycle with its derived opaque name and single versioned configuration constant, catalog-driven deletion with reconciliation, the usage meter, and the audit and error-pipeline events. The adapter that calls the managed index does not, because the index's metadata-filter semantics have never been observed against a real instance and a filter that fails open or is accepted-and-ignored cannot bear even the recall-optimization weight the design assigns it. Three decisions inside that split are recorded here rather than left implicit: the not-configured seam is a typed outcome selected on the absence of configuration and reachable through the production resolver, never a throw and never a clean empty success, because an adapter that resolves with no results is indistinguishable from a corpus in which nothing matched; the two metadata fields the managed index declares but the platform's own object-dimension reservation forbids writing (client, confidentiality_scope) are declared-and-unwritten rather than written, resolving a live contradiction between the design and a shipped invariant in favour of the invariant; and the embedding pin that the first provisioned instance would freeze is still open, so the management binding stays commented out and the pin must be frozen before any instance exists. The owner's 2026-08-07 override of flag A6 is built to: enablement gates on the firm's versioned disclosure, not on Cloudflare general availability."
---

**A feature can be complete and unshippable at the same time, and the honest response is to build all
of it except the part the missing evidence bears on.**

**Context.** The design for natural-language document search rests on one claim: the metadata filter
a query carries is a recall and cost optimization, and read-time re-authorization through the
firm-scoped data-access layer is the confidentiality boundary. That claim makes the feature safe
_given_ that the filter does approximately what it says. What is unknown is not whether the filter is
sufficient — the design already says it is not — but whether it does anything reliable at all. Three
of the vendor's own documentation pages disagree about the filter grammar, and a filter that is
**accepted and silently ignored** is the outcome that makes the whole arrangement unreadable.

The experiment that closes the question exists and is half done. Its protocol is built,
sensitivity-proven, and runnable
([`../research/2026-08-07-ai-search-filter-wall-experiment.md`](../research/2026-08-07-ai-search-filter-wall-experiment.md));
the live run against a fenced account has not happened, because no environment that has run this work
has had Cloudflare credentials.

**Decision.** Split the feature at the evidence line rather than at a work boundary, and merge the
larger part.

Built and merged: the consent gate and its versioned disclosure; the per-matter exclusion flag; the
derived text feed, its catalog, and the writer; instance lifecycle, provisioning, teardown and the
weekly keep-alive; catalog-driven deletion and reconciliation; the usage meter; audit and
error-pipeline events; the bindings and the gateway posture. Not built: the adapter that calls
`search()`, the filter builder, and the matter-scoped route.

Nothing in what merged can expose a query surface, and every gate is closed on merge — a firm with no
setting row produces no feed object, no instance, and an `instance-not-provisioned` outcome from the
port. That is the acceptance test, and it is written.

**Three sub-decisions, recorded because each is the kind that gets silently reversed.**

**1. The not-configured seam is a typed outcome selected on the absence of configuration.** Not a
throw at construction, which would make a deployment missing one binding fail to serve every other
surface. And — the failure that has actually bitten this codebase — not a fallback that quietly
*succeeds*: an adapter resolving cleanly with an empty result is indistinguishable from a corpus in
which nothing matched, which is precisely the failure where a lawyer finds nothing and concludes
there is nothing. An absent binding resolves, through the resolver production itself calls, to
`instance-not-provisioned`. A test drives that resolver rather than an injected double, in an
environment carrying neither binding — which is production's own configuration today.

**2. `client` and `confidentiality_scope` are declared on the managed index and written by nothing.**
The design specifies four custom metadata fields and gives `client` a populated value. The platform
independently **reserves** both names in `@magna-carta/object-dimensions`, written by no path, with a
fitness scan enforcing it — because there is no populated client link yet and a dimension absent on
most objects is worse than no dimension: a filter on it matches nothing while looking like it works.
Both cannot hold. The reservation wins: the fields are **declared** on the instance, because
declaring a metadata field later re-indexes every document in every firm's instance and declaring it
now is free, and they are **left unwritten**, because writing a dimension the platform has decided
not to populate would fork the object-metadata vocabulary in two. The feed object is stamped through
the same builder every other object in a firm's bucket uses, so the index reads the platform's own
stamp rather than a parallel one that could disagree with it. Lifting either reservation is one
change in both places.

**3. The embedding pin is still open, and the first instance would close it.** Creating an AI Search
instance fixes an embedding model that cannot be changed afterwards without re-embedding the corpus.
The platform's pin (`packages/inference/src/catalog.ts`) records `pinState: "open"` precisely to keep
that choice available, guarded by a scan that fails the moment code reaches a vector index. That scan
looks for the Vectorize binding by name and does not see this feature, so it does not fire — the
letter holds while the spirit does not. The management binding is therefore **declared and commented
out** in `wrangler.jsonc`, with the reason written beside it: uncommenting it is the act that closes
the pin, and the pin must be frozen deliberately first. This is named as an open item rather than
fixed here, because widening a fitness function in a package this work does not own is the wrong
place for it.

**The owner's A6 override is built to.** The design's prose still says general enablement waits on
Cloudflare taking the product out of open beta. The 2026-08-07 docket (ADR-0255) overrode that:
enablement waits on the firm's versioned disclosure acknowledgement and nothing else. In code that
override costs nothing — A6 was an operational posture and was never a gate — but it changes what the
acknowledgement gate is doing. Under A6 it was belt-and-braces behind a platform-level hold; under the
override it is the only thing standing between a firm and the feature, which is why the refusal lives
at the write path rather than at a surface, and why it is a typed refusal a caller must handle rather
than a check somebody could forget to make.

**Consequence.** The retrieval route stays gated on E1 and E2. If they fail, the feature does not ship
in any reduced form, and what merged here is deleted rather than repurposed — none of it has a second
consumer. If they pass, the remaining work is the adapter, the filter builder, and one route, against
seams that already exist and already run.
