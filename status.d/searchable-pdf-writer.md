---
slice: Searchable-PDF Writer
group: cross-cutting
order: 26
research: n/a
spec: done
plan: n/a
built: in-progress
ui: todo
load-profile: n/a
tested: in-progress
active-work: docs/active-work/searchable-pdf-writer.md
next: Wire the delivery path — the ocr-worker forward and a main-worker route + tools permission + OpenAPI for /ocr/searchable — and add the pdf-eval additive-only validation operation. Then the conversion orchestrator's scanned-to-searchable edge dispatches to it.
link-spec: docs/specs/2026-07-14-searchable-pdf-writer-design.md
link-plan:
adrs:
blocked-by:
---

`pdf_core::write_searchable_text_layer` writes an invisible (`3 Tr`) OCR text layer over a scanned page — selectable, copyable, searchable, with no visible change — reusing the Bates additive-append rule (existing bytes untouched, one shared non-embedded Type0/Identity-H font + ToUnicode, byte-identical output; Latin/CJK/Greek covered). The OCR container exposes it at `POST /ocr/searchable` (PDF in, searchable PDF out), owning the line-text/word-box split. Delivery wiring (worker route, permission, OpenAPI) and the pdf-eval validation op still to land. UI deferred.
