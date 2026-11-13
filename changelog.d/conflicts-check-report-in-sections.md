---
category: Changed
audience: public
---

**A conflicts check's account of its search is in sections, in plain words.** `describeCheck` (`packages/conflicts/src/report-text.ts`) returns keyed sections instead of a numbered sentence list. Each section has a heading, plain sentences and an `attention` flag. The sections are Searched, Names and identifiers, Relationships, Firm Employees, one per place beyond the Directory, Not searched, and Results. The check read's `statement` (string array) becomes `report` (`CheckReport` in `packages/conflicts/src/contract.ts`). The web files each place's section under its own place by key, where it used to match a sentence prefix. No reader-facing line carries a dash, and the unavailable-source reasons in `packages/conflicts/src/sources.ts` are now plain sentences. Results still ends "0 results." on an empty search that recorded everything it found. The printed and downloaded report has one section per part. No migration.

## Public

On a conflicts check, the Directory row of the Status section now opens onto blocks, one per row. They say when and by whom the search ran, how names and identifiers were compared, how far relationships were followed, how Firm Employees were checked, what was not searched and why, and what turned up. Anything not searched, or a part of the search that stopped short, is tinted so it stands out. The printed report has the same parts.
