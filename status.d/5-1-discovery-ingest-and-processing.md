---
slice: 5·1 — Discovery ingest and processing
group: phase-5
order: 1
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: n/a
load-profile: todo
tested: todo
branch: claude/discovery-5-1-1
active-work: docs/active-work/claude/discovery-5-1-1.md
next: 5·1·2 — the review-set model: identifiers, the discovery permission scope with review-set access NOT implied by matter access, the six per-firm tables in one migration, the load declaration and its coordinator Durable Object, and the internal and external load lanes
link-spec: docs/specs/2026-08-05-discovery-5-1-design.md
link-plan: docs/specs/2026-08-05-discovery-5-1-implementation-plan.md
adrs:
blocked-by:
---

**Sub-slice 5·1·1 built — the Rust discovery core, the sub-slice with the most unknowns and no Cloudflare, database, or worker in it.** `crates/discovery-core` on the engine-host seam: I/O-free, threadless, dual-target (native + `wasm32`), with a seven-code fixed error set whose own test proves no file content can reach an error payload. **Identification reads bytes and cannot read a name** — `identify` has no parameter a file name could arrive through, so a production's wrong names cannot route anything; comparing the two is a separate call whose answer is reported and never acted on, and a spreadsheet renamed to a picture still identifies as a spreadsheet. A ZIP is refined into the package it actually is (word-processing, workbook, presentation, OpenDocument, or a plain archive) and an OLE2 into the document it actually is (legacy Word/Excel/PowerPoint, an Outlook message, or an encrypted package) from entry names alone, with no decompression. **Normalization is the determinism boundary** — line endings, canonical composition, exotic spacing, and invisible characters all settle before anything derived, and everything derived is derived from its output; **the passage chunker moved out of `packages/search/src/extraction.ts` byte-for-byte**, carrying that suite's own corpus with the expected values copied rather than recomputed, because web and desktop feeding one index must agree about what a document says. Committed cross-target vectors run natively and under `wasm-pack`. Native extractors for text (with charset detection), OOXML (including shared-string resolution, so a workbook yields its words and not its indexes), OpenDocument, RTF, email over `crates/email-core`, and **PDF text layers over `crates/pdf-core` — the born-digital PDF that the shipped extraction port records as unextractable now extracts its real text and is never sent to recognition**. Archives enumerate without decompressing and expand under five guards checked before a byte is retained (depth, total bytes, ratio, entry count, and unconditional path-traversal rejection), with an encrypted entry reported rather than failing its siblings and a too-deep nested archive recorded rather than opened. Hosted by `containers/discovery` + `apps/discovery-worker` on the file-repair container pattern: `enableInternet` false, no `r2` feature, an engine failure a 422 carrying only the stable code. **No C-backed feature on any path**, asserted by a test that reads the crate's own manifest, and a hostile-input sweep runs every fixture through truncation, bit-flips, and absurd declared lengths against every entry point. The custodian-vocabulary gate ships early, scoped to the discovery trees, self-testing so it cannot silently stop biting.

Not built here and named: the review-set model and its schema (5·1·2), the queue lane and the composite extraction port that routes to this engine (5·1·3), and the corpus indexing, reads, and load profile (5·1·4). No user-facing surface exists yet, which is why UI is not applicable rather than deferred.
