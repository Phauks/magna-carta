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
tested: todo
branch: ocr-engine
active-work: docs/active-work/ocr-engine.md
next: Merge to main and run the container CI job (Docker unavailable locally) to confirm the image builds on trixie, the SHA-256 hash guard fails a bad pin, and the container boots and passes /ready.
link-spec: docs/specs/2026-07-09-ocr-engine-design.md
link-plan: docs/specs/2026-07-09-ocr-engine-implementation-plan.md
adrs:
blocked-by:
---

`crates/ocr-core` (PaddleOCR PP-OCRv6, small tier, via `ort`/ONNX) + `containers/ocr` + `apps/ocr-worker`; `POST /api/v1/ocr`, `tools:ocr` permission. UI deferred.
