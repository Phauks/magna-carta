---
branch: claude/discovery-5-1-design
worktree: C:/dev/magna-carta-worktrees/claude/discovery-5-1-design
area: Discovery (slice 5·1) — design only (the review-set model, ingest into a review set, processing, the shared Rust discovery core, index corpus scoping, scale)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream for the first built slice of Discovery, over the dormant groundwork that already
shipped: `crates/search-core` (split format, range-reading directory), `packages/search` (the
`SearchIndexPort` / `TextExtractionPort` seams), `apps/worker/src/search/*` (the enqueue → coordinator
→ consumer write pipeline, wired and deferred), `crates/email-core`, `crates/ocr-core`,
`crates/pdf-core`, `packages/metadata`, `packages/file-integrity`, and the File Manager ingest
chokepoint. It writes two specs, one decision fragment, and one changelog fragment, and touches
nothing in `packages/` or `apps/`. **No product code in this stream.**

What it settles: the review-set model (corpus, loads, load manifest, record-custodian attribution) and
the vocabulary that keeps discovery's "custodian" apart from the shipped **Custodian** register of
physical originals; the processing pipeline (identify, extract, dedup, families, exceptions) and where
each stage runs; the split between a new dual-target `crates/discovery-core` and the Containers
(OCR, LibreOffice) under golden rule 14; how processed text reaches the shipped index write pipeline
and whether the index is scoped per matter or per review set; and the scale obligations that discovery
volumes impose on per-firm D1, R2 layout, and queue throughput.

**Overlap to watch.** The design names, but does not write: a widening of the split catalog and the R2
split key from matter-scoped to corpus-scoped (`packages/search/src/split.ts`,
`packages/data-access/.../index-split-statements`, `apps/worker/src/search/*`); a composite text
extraction port that closes the born-digital-PDF gap named in
`apps/worker/src/search/text-extraction.ts` (platform-wide, not discovery-only); a narrowing of the
opaque-archive decision inside the discovery load path only; new identifier prefixes; a new per-firm
migration; a new queue lane and a new engine Container. It requires no change to `@magna-carta/trust`,
`@magna-carta/billing-core`, or `packages/custodian`.
