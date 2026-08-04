---
category: Added
---

**Discovery search-index catalog — the per-firm record of live index splits.** A new `index_split` table
in the per-firm database (the `FirmDatabase` Durable Object's self-migrating lineage) records one row per
immutable Tantivy split stored in the firm's R2: its object key, document count, size, schema generation,
and creation instant. This is the authority a query enumerates to learn which splits are live for a
matter — never an R2 bucket list, which would be slower and would not carry firm scoping structurally.
Because the index is durable per-firm data (unlike transient scan or conversion artifacts), the catalog
lives in the per-firm database, access-gated with the matter it belongs to. Splits are immutable: a row
is inserted on publish and marked superseded by compaction (kept until its object is garbage-collected,
so an in-flight query against the old split still resolves), never mutated in place. New data-access
statements cover the full lifecycle — insert a split, list a matter's live splits, mark one superseded,
and delete a superseded row — with an `IndexSplitId` identifier type.
