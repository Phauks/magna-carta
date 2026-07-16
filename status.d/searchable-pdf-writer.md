---
slice: Searchable-PDF Writer
group: cross-cutting
order: 26
research: n/a
spec: done
plan: n/a
built: done
ui: todo
load-profile: n/a
tested: done
active-work: docs/active-work/searchable-pdf-writer.md
next: Deferred seams — the conversion orchestrator's scanned-to-searchable edge dispatching to `POST /api/v1/ocr/searchable`, ingest-pipeline wiring (queues, per-job Durable Object, search index), rotated/skewed-quad placement beyond axis-aligned bounds, embedding a glyphless font if a target viewer needs a rendered selection glyph, and the UI.
link-spec: docs/specs/2026-07-14-searchable-pdf-writer-design.md
link-plan:
adrs:
blocked-by:
---

`pdf_core::write_searchable_text_layer` writes an invisible (`3 Tr`) OCR text layer over a scanned page — selectable, copyable, searchable, with no visible change — reusing the Bates additive-append rule (existing bytes untouched, one shared non-embedded Type0/Identity-H font + ToUnicode, byte-identical output; Latin/CJK/Greek covered). Reachable end to end: the OCR container serves `POST /ocr/searchable` (PDF in, searchable PDF out, owning the line-text/word-box split), the ocr-worker proxies it, and the main worker exposes `POST /api/v1/ocr/searchable` behind `tools:ocr`, streaming the PDF back. A pdf-eval operation checks the additive-only invariant. UI and ingest/orchestrator dispatch deferred.
