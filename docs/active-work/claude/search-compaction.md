---
branch: claude/search-compaction
worktree: .claude/worktrees/search-compaction
area: Discovery search — split compaction (merge per-document splits into one per corpus), plus the two engine absences the read-path benchmark surfaced
status: building
touches: crates/search-core, crates/search-eval, packages/search, packages/data-access/src/index-split-statements.ts, packages/database (per-firm schema + one migration), apps/worker/src/search, apps/worker/src/index.ts, apps/worker/wrangler.jsonc, docs/specs, docs/decisions/pending, changelog.d, status.d/discovery-search-index.md
---

Compaction for the discovery keyword index. The read-path benchmark measured 186,293 ranged reads for
one query over 5,000 per-document splits against 45 for the same documents compacted, which turns
compaction from a later optimization into a precondition for the search Container being usable. This
stream builds the merge pass in `crates/search-core`, the catalog supersession and membership tables,
the threshold sweep and queue consumer that drive it, and the per-split exclusion list that keeps a
re-indexed document from matching its own stale passages between compactions.

It also closes the two engine absences the benchmark named: no way to reuse an opened index across
queries, and no ranged multi-split query.

Concurrent streams should not edit `crates/search-core/`, `apps/worker/src/search/`,
`packages/search/`, or `packages/data-access/src/index-split-statements.ts` while this is in flight.
One per-firm migration index is taken; if another branch claims it first this stream retags.
