# ocr-creation-next-steps-6yko0b

**Scope.** OCR/discovery deferred follow-ups after PR #30 (searchable-PDF writer landed):

1. Searchable-PDF writer geometry fixes — the double-scale placement bug (done; committed) and
   rotated-page placement (open, container-side coordinate-frame work).
2. The discovery **search index** design — the stateful-service spec ADR-0167 owes: how a per-firm
   Tantivy keyword index + Vectorize semantic index are stored, isolated, scaled, and rebuilt on
   Cloudflare. Design-first; no code, no UI, no deploy this stream.

**Files expected to touch.**

- `crates/pdf-core/src/searchable.rs` (writer geometry)
- `docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md` (new)
- `docs/decisions/pending/` (search-index storage architecture fragment)
- `roadmap.d/discovery.md`, `changelog.d/` (fragments, on completion)

**Not touching:** release/deploy, any UI, the conversion engines.
