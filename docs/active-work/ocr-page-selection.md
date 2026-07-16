# ocr-page-selection

**Branch:** `claude/ocr-creation-next-steps-6yko0b` · **Off:** main (a2d8194) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-14

## Scope

Follow-up on the merged **OCR Engine** slice: the page-selection and raster-cap refinement that was
parked mid-transfer. Recognition is now gated on what a reader actually sees — visible-text coverage
weighed against raster coverage — instead of glyph presence, so a Bates-stamped scan is recognized
rather than skipped. Outsize exhibits are rastered to fit a pixel budget; geometry bombs are refused.
`?force=true` re-OCRs a document with a newer model. A region recognition could not decode is reported
as undecoded, never dropped.

Includes a correctness fix in shared PDF page observation (`textpos::draw_image`): image covers are now
measured over their full pixel extent, which the OCR coverage signal depends on and which also hardens
redaction (a vector box over an image is rejected across the whole image, not one corner).

Design: `docs/specs/2026-07-09-ocr-engine-design.md`. Plan: `docs/specs/2026-07-09-ocr-engine-implementation-plan.md`.

## Files I expect to touch

- `crates/ocr-core/src/engine.rs` — undecoded-region accounting (empty/zero-confidence decode counted, not dropped)
- `crates/pdf-core/src/lib.rs` — `rendered_pixels`, `MAX_RENDER_PIXELS`, `page_visible_text_coverage`, `page_raster_coverage`, `PageSize`
- `crates/pdf-core/src/textpos.rs` — image cover measured over full pixel extent
- `containers/ocr/src/lib.rs` — coverage-based `needs_recognition`, `?force`, error taxonomy, page-walk bound
- `containers/ocr/src/pages.rs` — `render_dpi_for` raster-density cap, density-aware coordinate transform
- `changelog.d/`, `status.d/ocr-engine.md`, the OCR references in the white paper + `ROADMAP.md` (PP-OCRv5 → v6)
