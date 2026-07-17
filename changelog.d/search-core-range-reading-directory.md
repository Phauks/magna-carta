---
category: Added
---

**Discovery keyword search — querying a split by ranged reads (`crates/search-core`).** The split format
was built to be stored in per-firm R2 and queried without downloading the whole index; this adds the
access path that makes that real. A read-only Tantivy directory serves the engine's reads straight off
the split's footer offset table through a new `RangeReader` seam: each read the engine issues for a term
dictionary block, a postings list, or a stored-field block becomes one ranged read of exactly those
bytes. In production the `RangeReader` is an HTTP range GET against the split's object in R2 (the adapter
lives in the search worker, kept out of this pure crate); a query over a large index then transfers a
small fraction of it, so per-query cost tracks the query's selectivity rather than the corpus size. An
instrumented in-memory reader proves it: a rare-term query reads well under half a split (and the
fraction shrinks as the corpus grows), reading a split's footer touches only its tail, and the ranged
path returns results identical to querying the whole split in memory. The directory is strictly
read-only — splits are immutable, so every write path is refused.
