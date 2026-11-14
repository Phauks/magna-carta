---
category: Changed
audience: internal
---

**The look of the Certificate of Completion is a package other documents are built on.** `@magna-carta/house-document` holds the house style of a generated PDF (half-inch margins, the accent, Atkinson Hyperlegible, the letterhead with the lockup, the page number) and the builders a document is made from: `card`, `noteLine`, `instantFields`, `groupedCode`, `pictureWidth`, `pagedTable` for a long table that runs over pages headed `Section (1 of 3)`, and `composeReadable` for the typeface fallback. `houseDocument` takes `letterhead: false` for a document that goes out under another heading. It is plain data with no engine in it. `certificateSheet` in `packages/signing` is rewritten on it and produces the same sheet, block for block; the lockup's picture moves from `packages/signing` to the new package.
