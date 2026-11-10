---
category: Fixed
audience: internal
---

**The OCR container builds again.** `pdf-core` gained a `PdfError::Encrypted` variant for password-locked documents, and the container's load-error mapping did not cover it, so the `magna-carta-ocr` Workers Build failed. A locked document now maps to `DocumentUnreadable`, the same permanent outcome as a document that will not parse.
