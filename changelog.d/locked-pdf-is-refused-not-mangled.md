---
category: Fixed
audience: internal
---

**A password-locked PDF is refused, not mangled.** The PDF engine's operations loaded a document that needs a password to open and then worked on its enciphered contents. Merging one wrote its pages out as unreadable noise and reported success; reading its form returned nonsense; stamping and watermarking failed with "failed to parse PDF". Every operation in `crates/pdf-core` that reads or rewrites content (Bates stamp, watermark, merge, split, rotate, form read, fill and flatten, sanitize, redact, signature preparation, searchable text layer) now checks `guard::is_locked` after loading and returns its `Encrypted` error, which `@magna-carta/pdf` reports as "the document is locked with a password; unlock it first". `decrypt` unlocks it. A document that carries only an owner's restrictions opens without a password and is worked on as before; the result is written without those restrictions, as it already was.
