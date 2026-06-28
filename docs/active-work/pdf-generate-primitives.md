---
branch: pdf-generate-primitives
worktree: C:/dev/magna-carta-worktrees/pdf-generate-primitives
area: PDF engine — generate primitives (merge / split / rotate / watermark) — the slice-4 remainder (Bates already shipped)
status: engine + WASM binding + docs built (merge-ready, pending adversarial review); Tools UI deferred to the 0·7 cycle
touches: crates/pdf-core/src/generate.rs (new — merge/split/rotate), crates/pdf-core/src/watermark.rs (new — overlay, reuses bates helpers), crates/pdf-core/src/lib.rs (exports), crates/pdf-core/src/wasm.rs (bindings), packages/pdf/src/index.ts (TS wrappers) + test, crates/pdf-eval (optional smoke), changelog.d/ + docs/decisions/pending/, STATUS.md (PDF-engine row), ROADMAP.md, docs/specs/2026-06-26-pdf-generate-primitives-{design,implementation-plan}.md
---

The remaining slice-4 "generate / assembly" primitives now that Bates numbering shipped:
**mergeDocuments**, **splitDocument**, **rotatePages**, **watermarkDocument**. All pure lopdf
model/overlay work — no rendering. Engine + WASM binding only; the Tools UI is deferred to the
0·7 cycle with the rest of the PDF surfaces.

Reuse: lopdf's merge recipe (`renumber_objects_with` + collect pages/objects + rebuild
Pages/Catalog) and rotate recipe (`/Rotate` delta); Bates's overlay machinery for the watermark
(`stamp_page` pattern, `escape_pdf_literal`, the standard-font width tables, the non-destructive
resource merge) + surgery's `resolve_mediabox`/`resolve_rotate`/`resolve_inherited_resources`.

Design: `docs/specs/2026-06-26-pdf-generate-primitives-design.md`.
Roadmap home: `docs/specs/2026-06-21-rust-pdf-engine-roadmap-design.md` (slice 4).
