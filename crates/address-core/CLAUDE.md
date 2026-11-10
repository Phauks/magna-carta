# address-core (crates/address-core) — CLAUDE.md

**Purpose.** The United States address autocomplete index: cleaning OpenAddresses rows, building one
single-segment Tantivy index per census-region partition and streaming it out in `search-core`'s split
format, and answering typed text with addresses and groups of units over splits read by range. Pure — no
HTTP, no buckets, no workers. `containers/address` binds it to object storage and runs it.

**Design:** [`docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md`](../../docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md).

## Key files

- `src/cleaning.rs` — normalisation, USPS suffix and directional abbreviation (in suffix or directional
  position only, so `LAWSON CREEK WAY` keeps its `CREEK`), unit designator stripping, the duplicate key.
- `src/partition.rs` — state to census-region partition.
- `src/schema.rs`, `src/build.rs` — the index and the streamed split.
- `src/query.rs`, `src/engine.rs` — parsing typed text, scoring, groups with exact counts, units.
- `src/address.rs` — the wire types and labels the container returns.

## Local rules

- **Scores are constants, not BM25.** Field norms and term frequencies are off, so BM25 would vary only
  with each partition's own statistics, and merging four partitions by it would be arbitrary. Required
  clauses score 1, a matching `near` region adds 2, a last word that matches as a whole word adds 1. A
  change here changes every ranking; measure it against real data before and after.
- **Nothing here carries a query or an address in an error.** `AddressError` is engine vocabulary so a
  caller may log it without redacting. Keep it that way — the query is a client's address.
- **Reads are the cost.** A warm keystroke is about two ranged reads at the median, because terms are
  prefetched in parallel and stored rows fetched concurrently. A change that adds sequential reads is a
  latency regression at R2's ~100 ms a read even when it is free locally; measure read counts, not
  milliseconds against memory.
- **A partition carries this crate's generation, not `search-core`'s.** The split format is borrowed;
  the schema is not. `ADDRESS_INDEX_GENERATION` (`src/schema.rs`) is what a build stamps in the footer
  and the only value the engine opens, so a change to how the document index cuts its words leaves
  every partition in the bucket readable. Bump it on any change to this crate's fields or analyzers,
  knowing that every partition is unreadable from that deploy until the next build publishes.
- **No panics on data.** The workspace lint floor denies them; OpenAddresses rows are untrusted input
  (the corpus carries house numbers like `127 56` and `N 505`).

## Gotchas

- `zstd-sys` (C) is in the tree through `search-core`'s Tantivy default features, not through anything
  here — this index stores rows with LZ4. Feature unification means it cannot be switched off from this
  crate alone.
- The prefix field starts at two characters; a one-character last word only adds a bonus, it never
  narrows.
