---
category: Added
audience: internal
---

**A watermark can mark chosen pages.** `WatermarkOptions` gains `pages` (`crates/pdf-core/src/watermark.rs`), and `watermarkDocument` in `@magna-carta/pdf` takes an optional `pages` list of 0-based page numbers; left out, every page is marked as before. A page listed twice is marked once, and a page past the end of the document is the error "page index out of range" instead of a silent skip.
