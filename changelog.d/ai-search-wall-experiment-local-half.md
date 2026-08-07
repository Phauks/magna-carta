---
category: Added
---

AI Search slice 0, local half: the filter-semantics wall experiment's runnable protocol harness
(`packages/search/test/natural-language-filter-wall/` — 34 tests). The E1 exclusion probe and E2
fail-open probe run as written against a reference model of the documented filter semantics and are
sensitivity-proven against deliberately broken engines (filter ignored, unknown field dropped,
malformed filter discarded, deletes never landing, query-text cache bleeding across matters); the
matter-scoped two-key filter, the feed-object key layout, and the catalog-driven delete/reassign
discipline are byte-pinned ahead of slice 1. **E1/E2 verdicts remain open** — the live run against a
fenced Cloudflare account is specified as a pass/fail checklist in
`docs/research/2026-08-07-ai-search-filter-wall-experiment.md`, and the retrieval route stays gated
until it passes.
