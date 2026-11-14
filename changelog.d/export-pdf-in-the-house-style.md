---
category: Changed
audience: public
---

**A tabular export's PDF is laid out in the house document style.** `composeExportDocument` (`apps/web/src/lib/export/render-pdf.ts`) now builds an `@magna-carta/house-document` document: the letterhead, margins, typeface and centred page number the Certificate of Completion uses, each section in a card, and a section too long for one page split across pages titled with its place. The worker composes through `composeReadable`, so a name in Greek or Cyrillic is still drawn.

## Public

Exported PDFs, reports among them, now have the same look as the other documents Magna Carta produces: the Magna Carta heading on every page, each table in its own titled box, and long tables split across pages with "(1 of 3)" in the title.
