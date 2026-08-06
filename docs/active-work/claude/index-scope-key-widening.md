---
branch: claude/index-scope-key-widening
worktree: .claude/worktrees/agent-a4cea4b4be5cfa458
area: search index — widen the dormant index scope key from matter to corpus
status: building
touches: packages/search/src/, packages/search/test/, packages/search/package.json, apps/worker/src/search/, apps/worker/test/search-*.test.ts, apps/worker/test/hybrid-search.test.ts, changelog.d/
---

Widens the search-index scope key from a bare matter identifier to a **corpus scope** —
the seam a future discovery review set drops into — while leaving every shipped byte
unchanged. A type and derivation change only: no new tables, no migration, no review-set
machinery.

## Scope

Widened (everything that touches the derived R2 key or the engine port):

- `packages/search/src/corpus.ts` (new) — `CorpusScope`, `corpusOfMatter`.
- `packages/search/src/split.ts` — `matterSplitPrefix` becomes `corpusSplitPrefix`;
  `splitObjectKey` takes a corpus.
- `packages/search/src/port.ts` — `matterId` becomes `corpus` on `index`, `remove`, `query`.
- `apps/worker/src/search/{index-consumer,keyword-search,search-engine}.ts`.

Deliberately left matter-shaped (the migration-bearing and wire-compatibility halves,
both cheap to widen when a second corpus kind actually exists):

- the `index_split` catalog column `matter_id` and its data-access statements — widening
  it is a per-firm schema migration, which this change is defined not to require;
- the `SearchIndexMessage` queue payload — an in-flight message must stay readable, and
  nothing durable is derived from its field names.

## Key shape

The R2 key stays byte-identical: `search/<corpusId>/splits/<splitId>.split`. A corpus
identifier is a self-describing prefixed handle (`matter_…` today), so a separate
corpus-kind path segment would be redundant *and* would change every key that exists —
the one outcome this change exists to avoid. Pinned in `packages/search/test/split.test.ts`.
