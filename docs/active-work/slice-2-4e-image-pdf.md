# slice-2-4e-image-pdf — active work

**Branch:** `slice-2-4e-image-pdf` (off `main`). **Area:** File conversion — image→PDF (pure Rust).

**Scope.** Extend the raster engine (`containers/raster`) to handle `to = "pdf"`: decode the source
image (existing path) → wrap in a single-page PDF via the **pure-Rust `krilla`** crate (no C — golden
rule 14). Add the registry edges (png/jpeg/webp/tiff/gif/bmp → pdf) under a new **server-only** engineId
`"image-pdf"`. No convert-worker change (the server resolver is engine-agnostic; the Container routes by
`from`/`to`).

**Files I expect to touch:**
- `containers/raster/Cargo.toml` (+ `Cargo.lock`), `containers/raster/src/convert.rs`, `containers/raster/src/lib.rs` (a route test), `containers/raster/CLAUDE.md`
- `packages/conversion/src/{format.ts,registry.ts,placement.ts}` + tests
- `docs/specs/2026-06-23-slice-2-4e-image-to-pdf-*.md`, `changelog.d/`, STATUS.md (2·4 row only)

**Out of scope:** the full PDF engine (PDF→PDF/→image/PDF-A, PDFium); multi-image PDFs; recipe-driven
page geometry; LibreOffice/email/FFmpeg.
