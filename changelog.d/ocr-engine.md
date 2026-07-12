---
category: Added
---

**OCR — a pure-Rust text-recognition engine reads scanned pages into searchable facts.** `POST /api/v1/ocr` (gated by a new `tools:ocr` permission) accepts an image or a PDF and returns per-page recognized text, word-level bounding boxes, confidence, and orientation, with provenance stamped onto every result. A PDF page that already carries a real text layer is skipped rather than re-recognized, and reported as skipped with a reason rather than returned as empty. The engine runs in its own firm-agnostic container (PaddleOCR PP-OCRv6, small tier, through the Rust `ort` binding to ONNX Runtime) that never learns which firm it serves and never fabricates a result — an inference fault surfaces as a retryable error, not a blank page. The end-user interface follows in a later pass.
