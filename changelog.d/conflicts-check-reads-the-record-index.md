---
category: Changed
audience: public
---

**A conflicts check reads names in calls, texts, tasks and Magnus through the record index.** `packages/conflicts/src/content-search.ts` asks `@magna-carta/search`'s record index for each subject party's names as exact phrases, firm-wide and index-led, instead of scanning those tables with LIKE. Matching is by whole word and folds case and accents. Each name keeps at most `NAME_RESULT_CEILING` (200) records per place, and the check's `inputs.places` records `namesAtCeiling`, which the report states. Numbers, addresses, linked records and email (not an index source) are matched on their own columns as before.

## Public

**Conflicts checks find names in calls, texts, tasks and Magnus conversations faster, and regardless of accents.** José Ortega now also finds "Jose Ortega". A name is matched as whole words, so it is never found inside a longer word. If one name appears in more than 200 records of one place, the first 200 are kept and the report says so.
