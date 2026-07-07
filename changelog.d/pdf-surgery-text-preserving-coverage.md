---
category: Fixed
---

PDF redaction: text-preserving redaction now succeeds on many more documents
instead of falling back to whole-page rasterization. Fonts whose character
widths are stored as indirect references (common in real-world PDFs, including
non-embedded and standard-14 fonts) are resolved correctly, and a stray
whitespace character left near the page origin no longer trips the safety check
that verifies text was removed. Redactions that could not be verified as
complete — including text drawn by embedded form templates — still fall back to
rasterization, so nothing sensitive is ever left behind.
