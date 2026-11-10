---
category: Added
audience: public
---

**A conflicts check searches the text of the firm's files.** `packages/conflicts/src/file-search.ts` asks each matter's file contents index, one matter at a time and never a discovery review set, for every subject party's names as exact phrases; results are tier 2 `content` hits with `foundIn.kind` `file`. The scope request's `places` takes `files` (Consultations, Open, Closed, Archived, where Archived is files deleted from a matter). Runs record `files` searched only when the index answered, and `unavailable` with its reason while `SEARCH_SERVICE` is unbound; matters left unsearched by the query ceiling, or whose query failed, are counted in the record and the report.

## Public

**Conflicts checks can now look through the text of your firm's files.** Files is on by default in New Check, with Consultations, Open, Closed and Archived (deleted files your firm still keeps). A result found in a file says it was found in a File and which matter it is on. Until your firm's file search is switched on, Files reads Not searched on the check, with the reason.
