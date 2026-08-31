---
category: Changed
audience: public
---

Three corrections to the Excel export on the owner's review: the menu now offers both layouts
(`Excel, Sheet per Table` behind a cover sheet, and `Excel, Single Sheet` with every section
stacked), both workbooks open with the report's title and the instant it was generated, and export
filenames are human (`Firm Usage 2026-08-31 19-48-43.xlsx` — the report's own name, the date, and
a readable time to the second, filesystem-unsafe characters dropped). Worksheet names are deduped
defensively so a title colliding with a section can never produce a workbook Excel refuses.

## Public

**The Excel export now comes your way.** Download it with each table on its own worksheet or
everything on one sheet, whichever suits how you work. Every file opens by saying exactly when it
was generated, and the file's name now reads plainly: the report's name, the date, and the time.
