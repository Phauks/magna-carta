---
category: Fixed
audience: internal
---

**An exported workbook never carries a `NaN` cell (#434).** `apps/web/src/lib/export/render-xlsx.ts` writes a non-finite figure as its text face instead of `<v>NaN</v>`, which Excel refused and offered to repair. Regression-tested in `apps/web/test/firm-usage-report.test.ts`. Drafted by the docs-sync routine from the merge.
