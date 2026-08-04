---
category: Added
---

**Discovery search write pipeline — documents now become index splits.** The half of the search
subsystem that was missing: nothing previously turned a matter's documents into splits and catalog rows,
so a query resolved an empty catalog no matter how much had been filed. A committed document version now
flows ingest → extract → build → catalog, driven by a queue consumer off the ingest path in the shape the
conversion subsystem already models (a `SearchIndexJob` Durable Object keyed `firmId:documentId:version`
over a `search-index` queue with its own dead-letter queue).

**One split per document version, so a retry converges instead of duplicating.** The split id is
_derived_ — a content-addressed handle from `documentId + version` (new `deriveIdentifier` in
`@magna-carta/identifiers`) — which fixes both the split's identity and its R2 key
(`search/<matterId>/splits/<splitId>.split`). Every attempt at the same version therefore writes the
same object and replaces the same catalog row: a retried job overwrites its own half-finished work
rather than leaving a second copy behind. Publishing is a delete-then-insert of the document's rows in
one atomic batch, and the `index_split` table gains `document_id` + `version` columns with a **partial**
unique index over the live per-document rows — so a duplicate delivery that raced past the delete still
cannot leave two live splits indexing one version, while the many-document splits a later compaction
publishes stay outside the constraint. New data-access statements cover the document lifecycle:
`listSplitsForDocument`, `deleteSplitsForDocumentStatement`, and `replaceDocumentSplitStatements`.
Superseded splits' R2 objects are reaped before their rows, so a re-index leaks no orphaned bytes.

**A deferred engine parks a job instead of failing it.** Neither engine is deployed yet — the index
Container is unbuilt and the text-extraction port resolves to the recognition service — and a pipeline
that retried against them would burn each message's attempts and dead-letter documents that were merely
early. The consumer's outcomes are therefore three, not two: `indexed`, `deferred` (acked, recorded on the
job, and re-startable so deploying an engine and replaying the enqueue drains the backlog naturally), and
`failed` (either terminal for unreadable bytes, or rethrown so the queue retries and finally
dead-letters). No document ever leaves the pipeline unaccounted for — a document silently missing from
discovery is a defensibility failure, not a cache miss.

**Gated per firm, enqueued at the ingest seam.** A new `search.indexing_enabled` firm setting (off by
default) is read at enqueue time on the ingest path, so a firm that has not opted in never has its
documents extracted or written to R2. The enqueue hangs off the clean commit in the files-ingest
consumer — the first moment a version is durable, scanned, and current — and is best-effort, so a
failure to enqueue can never unwind an ingest that already succeeded. A new `TextExtractionPort` covers
the extract stage over the recognition engine, with typed outcomes that let the consumer tell "no engine
yet" from "these bytes are unreadable".
