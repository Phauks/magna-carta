# ocr-engine

**Branch:** `ocr-engine` · **Off:** main · **Owner:** Trevor Goldsmith · **Started:** 2026-07-09

## Scope

The **OCR engine** and nothing downstream of it. Raw facts only: an image or a PDF goes in, per-page
recognized text, word-level bounding boxes, confidence, orientation, and provenance come out. The
container writes no files and never learns which firm it serves.

Amends ADR-0060: crate resolves to `oar-ocr`, model moves to the official first-party PP-OCRv6 ONNX
export, and the determinism claim narrows to server-canonical. Golden rule 14 C++ consent granted for
ONNX Runtime, on the grounds that it adds no new C++ surface and never parses untrusted bytes.

Design: `docs/specs/2026-07-09-ocr-engine-design.md`.
Decision: `docs/decisions/pending/ocr-engine-model-and-determinism.md`.

## Files I expect to touch

- `crates/ocr-core/**` (new — the engine: pixels in, facts out; no I/O, no serde)
- `containers/ocr/**` (new — axum on the engine host, `/ready` + `POST /ocr`; **trixie base image**, not bookworm)
- `apps/ocr-worker/**` (new — container Durable Object + verbatim forwarding proxy, scale to zero, no warm cron)
- `apps/worker/` — `POST /api/v1/ocr` route, `OCR_SERVICE` binding added to the single `services` array
- `packages/access-control/src/registry.ts` — `tools:ocr` permission
- `packages/tools/src/catalog.ts` — tool-catalog entry (UI deferred)
- `packages/database/drizzle/per-firm/` + `apps/worker/src/per-firm-migrations.ts` — role-grant seed migration
- `crates/pdf-eval/src/validate/operations/ocr.rs` (new — validation operation)
- `crates/Cargo.toml` — new workspace member
- fragments: `changelog.d/`, `docs/decisions/pending/`, `status.d/`

## Not in this stream

No invisible text-layer writer, so no searchable-PDF output — that is the next slice, in `pdf-core`
beside the Bates content-append path. No ingest-time OCR, no queue, no job-coordinator Durable Object,
no search index, no Tauri desktop path, no user interface.

## Overlap watch

Reads `pdf-core` (`render_page`, `page_text_rects`) but does not modify it. Adds a `pdf-eval` validation
operation alongside `forms` and `surgery` — coordinate with any stream touching `crates/pdf-eval/src/validate/`.
Touches `apps/worker/wrangler.jsonc` (`services` array) and the tool-registration surface, which collide with
any other new-tool stream.
