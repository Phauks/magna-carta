---
number: 252
slug: ai-search-retrieval-only-natural-language-search
status: Proposed
date: 2026-08-06
area: Search
summary: "Cloudflare AI Search is adopted for one shape only — a firm-facing, retrieval-only natural-language search over a firm's own working documents, opt-in per firm and off for everyone on merge. One instance per firm (the only allocation that scales past the 100-namespace and 5,000-instance ceilings), fed not from the firm's bucket but from a derived prefix holding already-extracted text, so what can enter the index is an allow-list of exactly one object class and Magnus transcripts, review-set originals, and mid-edit working copies are absent by construction rather than by rule. The metadata filter is explicitly NOT the ethical wall: every hit is re-authorized against the caller's entitlement through the firm-scoped data-access layer before any of its text is returned, and a filter's semantics are proved by a fenced synthetic experiment before the retrieval route ships at all. Slice 1 is matter-scoped only; firm-wide waits on a proven disjunction and a measured recall figure. No generation, no public endpoint, no MCP, similarity cache off, and no firm enabled until Cloudflare takes the product to general availability with final pricing."
---

**Adopt Cloudflare AI Search for a retrieval-only, opt-in, matter-scoped natural-language document search — instance per firm, fed from a derived text feed, with read-time re-authorization rather than filter-as-wall.**

**Context:** The merged assessment
(docs/research/2026-08-06-cloudflare-ai-search-assessment.md) concluded adopt-partially: refuse AI Search
for the discovery keyword engine, keep it as the leading candidate for the unbuilt semantic half, and
prove it on a firm-facing natural-language search over a firm's own working documents. The owner directed
that the design follow ("when ai search lands design then flags") and that it be opt-in like the
platform's other AI features. Three constraints were already binding: instance-per-firm is the only
allocation that scales; the Tantivy keyword engine is kept; and the filter semantics that an ethical wall
would rest on are undetermined because Cloudflare's own documentation contradicts itself.

**Decision:** Build the retrieval-only surface, designed at
docs/specs/2026-08-06-ai-search-integration-design.md. One instance per firm, provisioned when an
administrator opts in and torn down on opt-out. The data source is not the firm's R2 bucket — which holds
received productions, mid-edit working copies, and binary index splits — but a derived feed prefix holding
already-extracted text, written by a single allow-listed producer. The matter dimension the filter uses is
copied from the R2 object metadata task 110 builds, never re-derived. The metadata filter is treated as a
recall and cost optimization, not a security boundary: every returned pointer is re-resolved and
re-authorized through the firm-scoped data-access layer before any text reaches a caller, and a dropped hit
raises a highest-severity event. Filter semantics are proved first, by a fenced experiment on synthetic
fixtures with a stated refusal rule — if the single-key exclusion test fails, or if filters are shown to
fail open, the feature does not ship. Slice 1 uses one `$eq` filter and needs no disjunction; firm-wide
scope waits on a proven disjunction and a measured recall figure, for reasons of utility rather than
safety. Refused outright: generation of any kind, public endpoints, MCP, query rewriting, the similarity
cache, and any reliance on the filter as the wall.

**Consequence:** Discovery search is untouched — the keyword engine, the split catalog, and the write
pipeline are unchanged, and the semantic half's engine choice stays deferred behind `SearchIndexPort` and
discovery flag D4. Magnus transcripts cannot reach this index (they are database rows, not R2 objects), so
the ratified F4b include/exclude control remains discovery's and is not duplicated here; the `object_class`
field is nevertheless declared and stamped from day one so the exclusion predicate exists before any
work-product class could be fed. The Magnus `MagnusContextPort` seam is filled by this port at
matter grain, matching the ratified F3 per-conversation grant, and filling it increments Magnus's
disclosure version. Slice 1 is blocked on task 110 and its retrieval route is blocked on the experiment;
general enablement for any real firm is blocked on Cloudflare taking AI Search out of open beta with final
pricing. Six owner flags carry recommended defaults the design and plan already implement.
