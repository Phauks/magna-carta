---
slice: Indexing and discovery
group: cross-cutting
order: 48
research: n/a
spec: done
plan: n/a
built: in-progress
ui: in-progress
load-profile: in-progress
tested: done
branch: claude/project-thread-rixee1
active-work: docs/active-work/claude/project-thread-rixee1.md
next: accent folding in the file contents engine before the first production index is built, then the Search and Indexing status screen and the top-bar search across matters, which has to bound a search for a word most records contain before it ranks one
link-spec: docs/specs/2026-11-10-indexing-and-discovery-design.md
link-plan:
adrs:
blocked-by:
---

One structure for everything the platform searches, approved by the owner on 2026-11-10: one list of searchable places, three indexes behind it, and three rules that hold across all of them. Access is checked twice, once where the index narrows and again where the consumer's own statement decides; every asker has a named reach (a person reads the matters they can see, a conflicts check reads the firm, a review reads one review set); and every index is a copy that can be rebuilt from the records it was derived from.

**Built: the record index, and the matter search reading it.** `@magna-carta/search` declares eight sources of prose held in database rows (notes, time narratives, cost descriptions, calendar events, calls and texts, tasks, Magnus conversations and their turns) and renders from each declaration the triggers that keep it indexed, the statement that fills it from existing rows, and the statement that rebuilds it. Triggers are the only write path, so no editor, import or erasure can forget the index, and a lineage test applies every migration and compares the triggers a firm's database carries with what the declarations render today, word for word. The matter search reads the index for its five sections that hold writing and keeps substring matching for names and numbers.

**The shape was measured before it was fixed.** `packages/search/scripts/measure-record-index-shapes.mjs` builds three candidate shapes over 200,000 synthetic records and times the reads against the substring scan they replace. Prefix indexes were dropped because they took the index from about 60 percent of the text's size to 163 percent; the source became a column instead of a token because the token added milliseconds to a read that otherwise takes microseconds. The matter search's own statements, measured on the load-profile volume, are much faster for a word few records contain and about level for a word a quarter of them contain.

**Two limits are recorded instead of solved.** A ranked read scores every match, so its cost grows with how many records contain the word; the search across matters has to bound that before it ships. And the fill runs inside the migration, which is right at today's sizes and should become a batched rebuild before a firm with around a million indexed records applies one.

**Built ahead of its place in the order, at the owner's request on 2026-11-10: matter search reading the file contents index.** A second source on the Files section asks the keyword engine for the matter's own corpus and answers with the files whose text matches and the pages they matched on. The engine names candidates and the firm's `file` table decides, under the same matter binding as every other source. It answers nothing in production until the search worker is deployed and bound and a firm turns indexing on, and it says which of those is missing.

**Built: the firm's switch for file indexing.** Settings, Data & Platform, Search and Indexing reads and writes the firm's `search.indexing_enabled` setting through `GET`/`PATCH /api/v1/firm/search-settings`, behind a new `firm:manageSearchSettings` permission seeded to Owner and Admin. Turning it on starts a bounded walk of the files the firm already holds (the daily repair pass draws in the rest), and the page says so, and says when the platform's search service is not connected, instead of letting "on" read as "searchable". A matter's search that answers "turned off for this firm" now names the page.

**Not built:** the status screen, the search across matters, the conflicts content search reading the index (its own stream), the kept text that would let a file result quote its sentence, the per-split word summary, and the discovery review screens (the coding panel waits on owner flags P1 and P3).
