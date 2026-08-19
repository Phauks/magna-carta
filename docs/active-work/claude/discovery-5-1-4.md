---
worktree: .claude/worktrees/agent-a8d7aca8478fdcc1e
area: Discovery — sub-slice 5·1·4 (corpus indexing, the reads the review surface sits on, and the load profile)
status: building
touches: packages/search, packages/data-access/src/index-split-statements.ts, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, packages/discovery, packages/fixtures/src/load-profile, apps/worker/src/search, apps/worker/src/routes/discovery.ts, apps/worker/openapi/openapi.json, packages/api-client/src/types.gen.ts, roadmap.d/discovery.md, docs/now.md, docs/now.html, docs/decisions-open.html, STATUS.md, STATUS.json, ROADMAP.md, docs/user
---

The corpus index enqueue for review documents, the member-facing discovery reads the review surface
pages through, and the discovery volume in the load profile. Backend only — no review UI, which is
deferred to the owner.

The enqueue lands beside the existing version-keyed one, into the review-set corpus, through the
same coordinator and the same consumer; a `failed` or `deferred` outcome writes a
`review_document_exception`, so an unindexed document is visible in the exception report rather than
only inside a Durable Object. That first needs the half of the ratified corpus widening the split
CATALOG never received — the catalog is still keyed by matter, and a review-set split published into
it would be enumerable by a matter query — so `index_split` gains `corpus_kind` / `corpus_id` and
every scope read moves onto them.

The reads: the review-set list (which is not access-scoped today and becomes so), the
review-document list page filtered by record custodian, load, family, processing state and exception
code, the exception report read, the load status read, and the occurrence read.

Semantic indexing is deliberately NOT built: owner flag D4 is open, so the `semantic_index_enabled`
seam stays a flag nothing reads and the question is recorded on the discovery ledger node.

**Concurrent stream to watch:** `claude/passive-dev-orchestrator-m7f9jw` also touches
`apps/worker/openapi/openapi.json`, `packages/api-client/src/types.gen.ts`, `roadmap.d/` and the
rendered `docs/now.*`. Both are regenerated artifacts — re-render after merging rather than resolving
the diff by hand.
