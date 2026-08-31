---
category: Added
audience: public
---

The export seam's third renderer: `$lib/export/render-xlsx.ts` writes a native Excel workbook —
one worksheet per section, a bold frozen header row, and typed number cells with the grouped
format wherever the document carries a figure. Built on write-excel-file, pinned exactly at 4.1.1
and imported lazily so no page carries it until someone exports; the adoption trail (exceljs,
SheetJS CE, and xlsx-populate weighed and declined) lives in the export seam's pending decision
record. Export document cells grew a second face for it: formatted text for the text and CSV
renderers, the raw number for Excel.

## Public

**Export straight to Excel.** Download Report now offers a real Excel workbook: each section on
its own worksheet with its headings pinned, and every count a genuine number, so you can sum and
sort your figures instead of fighting text that looks like numbers.
