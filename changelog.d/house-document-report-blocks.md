---
category: Added
audience: internal
---

**A generated PDF can carry summary figures, a totals row, a cover label and signature lines.** The PDF composer (`crates/pdf-compose-core`) gains row styles on a table (`total` is bold under a darker rule, `child` is gray and stepped in, `muted` is gray), a `figures` block of up to six summary figures to a line with one that can be printed in red, a `display` block for the large centred label of a cover sheet, and a `signatureLines` block. `@magna-carta/house-document` gains the builders a report and an exhibit list use them through: `figures`, `styledTable`, `coverSheet` and `signatureLines`. Documents already generated are unchanged.
