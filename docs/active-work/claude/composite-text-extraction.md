---
branch: claude/composite-text-extraction
worktree: .claude/worktrees/agent-ab9295a24cf001677
area: Search — composite per-page text extraction (native text layer first, recognition only where there is none)
status: building
touches: crates/pdf-core/, containers/ocr/, packages/pdf/, packages/search/, packages/file-manager/, apps/worker/src/search/, apps/worker/src/index.ts, changelog.d/
---

Closes the platform-wide search-correctness gap the Discovery 5·1 design records: the shipped
`TextExtractionPort` is recognition-backed only, and the recognition engine deliberately skips a page
that already carries a text layer — so a born-digital PDF (the most common document in a law firm)
extracts to nothing and the write pipeline records it `unextractable`.

What it builds:

- **`crates/pdf-core`** gains native text-layer extraction (`Document::page_text_lines`) built on the
  glyph observation the crate already runs, and `Document::page_needs_recognition` — the recognition
  gate lifted out of `containers/ocr` so the extractor and the recognizer cannot disagree about which
  pages have a text layer. The container delegates to it.
- **`packages/pdf`** exposes the extraction as one wasm edge (`extractPdfText`).
- **`packages/search`** grows the port contract by per-page provenance (`native` / `ocr`), so a
  downstream consumer — the discovery exception report — can tell the two apart.
- **`apps/worker/src/search/text-extraction.ts`** becomes the composite adapter: native first,
  recognition only for the pages the gate says still need it, composed per page.
- A **re-extraction sweep** on the existing daily reconciliation cron re-enqueues clean versions that
  carry no live index split, which is what repairs documents already recorded `unextractable`.

**Files owned by this stream**

- `crates/pdf-core/src/{textextract.rs,lib.rs,wasm.rs}`, `crates/pdf-core/tests/fixtures/*`
- `containers/ocr/src/lib.rs`
- `packages/pdf/src/index.ts`, `packages/pdf/test/text-extraction.test.ts`
- `packages/search/src/extraction.ts`, `packages/search/test/extraction.test.ts`
- `packages/file-manager/src/queries.ts` (one added query)
- `apps/worker/src/search/{text-extraction.ts,reextraction-sweep.ts}`, `apps/worker/src/index.ts`,
  `apps/worker/src/wasm-modules.d.ts`, `apps/worker/package.json`
- `changelog.d/composite-text-extraction.md`

**Overlaps to watch.** No migration is taken (journal head stays at idx 30). The OpenAPI contract is
not moved, so this stream does not contend with the two in-flight branches that do. `apps/worker/src/index.ts`
gains one call inside the existing daily reconciliation pass; `packages/file-manager/src/queries.ts`
gains one appended query.
