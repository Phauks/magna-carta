---
category: Added
audience: internal
---

**The bank statement reader, the first part of reading PDF statements into a reconciliation.** `extractPdfTextGlyphs` (new in `@magna-carta/pdf`, over `Document::page_text_glyphs` in `crates/pdf-core`) returns every visible glyph with its position and the page's size, beside the same per-page recognition gate `extractPdfText` reports. `readStatement` (`packages/trust/src/statement-reading.ts`) turns positioned text, a born-digital page's glyphs or a recognized page's words, into the statement's opening and closing balances, its dated lines with signed amounts and running balances, the lines it could not read and why, and whether the lines add up. Direction comes from the column headers, then the running balance, then a printed sign, and is never guessed; the date order is stated by the caller. Nothing calls it yet: storing what it reads and showing suggestions on the Reconciliation screen follow.
