---
category: Changed
audience: public
---

**A report's PDF prints its totals the way the screen shows them.** `composeExportDocument` (`apps/web/src/lib/export/render-pdf.ts`) opens a report with its summary as `figures` (an attention figure in red), and a section with a payload total or a client's matters becomes one `styledTable` with `total` and `child` rows, carried over pages by the composer. The export section's new `rowKinds` and the document's `summary` carry this; the text, CSV, spreadsheet and Word files are unchanged.

## Public

Report PDFs now open with the report's totals across the top of the first page, print each table's total in bold under a darker rule, and step a client's matters in under their client.
