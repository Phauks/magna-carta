---
category: Added
---

**Discovery keyword search — the index core (`crates/search-core`).** The first buildable slice of the
search-index design: a pure-Rust crate (Tantivy 0.26, no C dependency) that builds a keyword index from
extracted passages and packages it as a self-contained **split** — the index's files bundled into one
byte string with a footer that locates each file and records the document count and schema generation.
A split is how the index leaves the machine that built it: one blob that can be stored under a single
per-firm R2 key and enumerated without listing the bucket, written once and never mutated. The crate
builds splits, queries them (BM25 keyword and phrase search, merged across multiple splits into one
ranked list), reads a split's footer without opening the index, and refuses a split from an
incompatible schema generation rather than misreading it. Hits carry only the pointers needed to
hydrate a passage through the data-access layer, never its text — the index is a term index, not a
document store. No user-facing surface yet; the crate is the engine the search worker will wrap.
