---
slice: OCR Engine
group: cross-cutting
order: 22
research: n/a
spec: done
plan: done
built: done
ui: todo
load-profile: n/a
tested: done
branch: claude/ocr-creation-next-steps-6yko0b
active-work: docs/active-work/ocr-page-selection.md
next: Deploy with `git push origin main:release` to run Workers Builds (Docker unavailable locally) — confirm the image builds on trixie, the SHA-256 hash guard fails a bad pin, and the container boots and passes /ready, then exercise the model-backed recognition tests (`--ignored`) in the container CI job.
link-spec: docs/specs/2026-07-09-ocr-engine-design.md
link-plan: docs/specs/2026-07-09-ocr-engine-implementation-plan.md
adrs:
blocked-by:
---

`crates/ocr-core` (PaddleOCR PP-OCRv6, small tier, via `ort`/ONNX) + `containers/ocr` + `apps/ocr-worker`; `POST /api/v1/ocr`, `tools:ocr` permission. Page selection weighs visible-text coverage against raster coverage rather than glyph presence, so a Bates-stamped scan is still recognized; outsize pages are rastered to fit a pixel budget and geometry bombs refused. Page-walk, skip-gate, coordinate-transform, raster-cap, and wire-mapping logic are unit- and integration-tested green; model-backed recognition runs in the container CI job. UI deferred.
