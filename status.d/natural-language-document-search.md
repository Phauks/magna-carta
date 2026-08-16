---
slice: Natural-language document search
group: cross-cutting
order: 39
research: done by="Opus 5"
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: todo
load-profile: todo
tested: in-progress by="Opus 5"
branch: main
active-work:
next: The retrieval port's adapter and the matter-scoped route — blocked until the filter-wall experiment's E1 and E2 have been run against a real instance
link-spec: docs/specs/2026-08-06-ai-search-integration-design.md
link-plan: docs/specs/2026-08-06-ai-search-integration-implementation-plan.md
adrs: ADR-0003, ADR-0110, ADR-0111, ADR-0255
blocked-by: E1 and E2 of the ethical-wall filter experiment (docs/research/2026-08-07-ai-search-filter-wall-experiment.md) — the local half is proven and runnable; the live run against a fenced account has not been executed
---

Slice 1 landed with **every gate closed**: no firm has the setting on, no instance exists for any
firm, and no feed object has been written. Built: the consent gate (`search.naturalLanguageEnabled`,
default off) behind a firm-level **versioned disclosure** whose acceptance is the precondition the
write path refuses without; the per-matter exclusion flag, which deletes a matter's existing feed
objects rather than merely stopping new ones; the derived text feed and its catalog, written by the
existing search index job as a **second consumer of the extraction it already computed**; the
instance lifecycle (derived opaque name, one versioned configuration constant, queue-dispatched
provisioning and teardown, weekly keep-alive); catalog-driven deletion with reconciliation against
the bucket; the usage meter, keeping authoritative counts structurally apart from the one estimated
figure and naming managed storage as an unmetered gap; audit and error-pipeline events carrying no
query text; both bindings declared-and-commented in `wrangler.jsonc` with the gateway posture in the
deploy runbook.

**Deliberately not built: the retrieval adapter and route.** The managed index's metadata-filter
semantics have not been observed against a real instance, and a filter that fails open — or is
accepted and silently ignored — cannot bear even the recall-optimization weight the design puts on
it. Both ports resolve to typed unavailable outcomes reached through the production resolvers.
Owner direction (ADR-0255) removed the general-availability gate: enablement waits on the firm's
versioned disclosure, not on Cloudflare leaving beta.
