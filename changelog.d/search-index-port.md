---
category: Added
---

**Discovery search — the `SearchIndexPort` seam (`@magna-carta/search`).** The single domain interface
every search feature reaches the index through: `index` a document's passages, `remove` a document, and
`query` a matter (keyword, semantic, or hybrid). It follows the same discipline as the conversion and
inference ports — every operation returns a typed outcome, never a thrown error, so a caller
pattern-matches an engine or transport failure rather than catching it, and `engine-not-implemented` is a
first-class result while the engine Container is deferred. The port is the boundary between the app
Worker (which owns the per-firm catalog and firm scoping) and the future dedicated search Worker's
Container (which owns the Tantivy engine): a query carries the live split object keys the caller resolved
from the catalog, so the engine range-reads exactly those and never reaches the per-firm database. No
user-facing surface yet; the interface and its typed outcomes are covered by tests.
