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
branch: main
active-work:
next: Deferred seams — rotated-page (`/Rotate` 90/180/270) placement: the layer is written in the unrotated frame, so selection geometry is off on rotated scans (text stays searchable) — needs a counter-rotating text matrix like `bates.rs`; ingest-pipeline wiring (queues, per-job Durable Object, search index; blocked on the unbuilt discovery/search subsystem); skewed-quad placement beyond axis-aligned bounds; embedding a glyphless font if a target viewer needs a rendered selection glyph; and the UI. (The conversion orchestrator's scanned→searchable edge is now wired — `pdf → searchable-pdf` in the conversion registry, dispatched to the OCR service. An adversarial review hardened the writer: non-BMP characters, font-name collisions, and degenerate word boxes are fixed.)
link-spec: docs/specs/2026-07-14-searchable-pdf-writer-design.md
link-plan:
adrs:
blocked-by:
---

`pdf_core::write_searchable_text_layer` writes an invisible (`3 Tr`) OCR text layer over a scanned page — selectable, copyable, searchable, with no visible change — reusing the Bates additive-append rule (existing bytes untouched, one shared non-embedded Type0/Identity-H font + ToUnicode, byte-identical output; Latin/CJK/Greek covered). Reachable end to end: the OCR container serves `POST /ocr/searchable` (PDF in, searchable PDF out, owning the line-text/word-box split), the ocr-worker proxies it, and the main worker exposes `POST /api/v1/ocr/searchable` behind `tools:ocr`, streaming the PDF back. A pdf-eval operation checks the additive-only invariant. UI and ingest/orchestrator dispatch deferred.
