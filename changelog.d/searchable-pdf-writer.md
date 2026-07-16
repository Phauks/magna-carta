---
category: Added
---

**Searchable PDFs from scans — an invisible OCR text layer makes an image-only page selectable and searchable.** `POST /ocr/searchable` recognizes a scanned PDF and returns it with the recognized text written back over each page in an invisible render mode: copy, select, and full-text search now work, with nothing new visible. The layer is strictly additive — every existing byte of the document is preserved, and a page that already carries real text is left untouched — and deterministic, so re-running the same document produces the same bytes. Text extraction rides a `ToUnicode` map rather than a rendered glyph, so Latin, CJK, and Greek all come back correctly, and the written text is itself findable by redaction. The end-user interface and the ingest-pipeline wiring follow later.
