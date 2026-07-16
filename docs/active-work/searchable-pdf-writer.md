# searchable-pdf-writer

**Branch:** `claude/ocr-creation-next-steps-6yko0b` · **Off:** main (a2d8194) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-14

## Scope

The scanned-to-searchable half of the OCR program: take the recognized text and word boxes the
OCR engine produces and write them back onto the scanned page as an invisible text layer, so an
image-only PDF becomes selectable, copyable, and searchable. Shares one home with the Bates
content-append path in `pdf-core`; additive, deterministic, and self-verifying.

Design: `docs/specs/2026-07-14-searchable-pdf-writer-design.md`.

## Files I expect to touch

- `crates/pdf-core/src/searchable.rs` (the writer, its input types, ToUnicode/font construction) — **landed**
- `containers/ocr/src/lib.rs` (`POST /ocr/searchable`: recognize -> adapt -> write) — **landed**
- `crates/pdf-eval/src/validate/operations/searchable.rs` (additive-only validation op) — **landed**
- `apps/ocr-worker/**` + the main worker route + `tools:ocr` reach + OpenAPI for `/ocr/searchable` — **landed** (delivery wiring)
- Docs: `changelog.d/`, `status.d/searchable-pdf-writer.md`, `docs/decisions/pending/` — **landed**

Buildable scope complete. Deferred seams (per the design's out-of-scope): conversion-orchestrator dispatch, ingest wiring, rotated-quad placement, embedded glyphless font, and the UI.
