---
slug: text-held-in-rows-is-indexed-beside-it-by-triggers
status: Proposed
area: Search
date: 2026-11-10
summary: "The text a firm holds in database rows — notes, time narratives, cost descriptions, calendar events, calls and texts, tasks and Magnus conversations — is indexed in the same per-firm database by one contentless full-text table, written only by triggers rendered from one list of declared sources. It reverses the matter-search design's \"no search table\" line for prose, and leaves names and numbers on substring matches. Files stay in the keyword engine and natural-language search is unchanged. Every index is a copy, every asker has a named reach, and access is checked in the question and again on each result. The shape was set by measurement: the matter is a token inside the index, the source is a column beside it, and there are no prefix indexes."
---

**Text held in rows is indexed beside it, by triggers, from one list of declared sources.**

**Context:** the owner approved the indexing and discovery design on 2026-11-10
([`docs/specs/2026-11-10-indexing-and-discovery-design.md`](../../specs/2026-11-10-indexing-and-discovery-design.md)).
Until then the only search over row text was the matter search, a substring scan that is affordable
because one matter fences it; its design
([`docs/specs/2026-08-31-matter-consolidated-search-design.md`](../../specs/2026-08-31-matter-consolidated-search-design.md))
said there would be no search table and that a source that would not hold "moves behind an index".
A conflicts check and a search across matters have no such fence, the firm-wide note search was
recorded as waiting on an index decision, and the conflicts check was scanning Messaging, Tasks and
Magnus across the firm.

**Decision.**

1. **One index for row text, in the firm's own database.** `record_text_entry` (one row per indexed
   record) and `record_text_fts` (a contentless full-text table keyed by it). The index holds terms
   and no text, so a match is a pointer and what a reader is shown is read from the record, behind
   the record's own rules.
2. **Triggers are the only write path**, rendered from the declarations in
   `packages/search/src/record-index-sources.ts`. No domain package calls the index when it saves.
   Adding a source is a declaration plus a migration carrying its rendered triggers and fill; a
   fitness test holds the applied lineage to the declarations word for word.
3. **Prose only.** Names and numbers stay on substring matches over their own columns. Protected
   columns and review-set tables are refused as sources by a fitness test. Email waits for its own
   matter-link model.
4. **The matter search reads the index for its prose sources** (notes, time, costs, calendar, and
   the words of a call or text), which changes their matching from substring to word: every word
   typed must be present, the last may be the start of a word, quoted text is an exact phrase, case
   and accents fold. The matter binding, the visibility predicate and the limit are still composed
   by the source's own statement.
5. **Three rules bind every index and every asker**: access is checked in the question and again on
   each result; each asker has a named reach (a person's visible matters, the whole firm for a
   conflicts check, one review set for discovery and nothing else for a review set); every index is
   a copy that a rebuild restores.

**Alternatives considered.** A trigram index (substring-capable) was rejected on size: on the same
generated text it measured about three times the size of the text, against a firm database's storage
ceiling, where the index as built measured about 60% of it
(`packages/search/scripts/measure-record-index-shapes.mjs`). One full-text table per source was rejected because a firm-wide question
would then be eight queries with eight rankings. Feeding rows to the keyword engine was rejected
because that engine indexes objects in a bucket asynchronously, and a note edited to remove a name
must stop being findable by that name in the statement that edits it.

**Consequences.** A search across matters and a conflicts check over row text become reads
proportional to what matches instead of to what the firm holds. Every write to an indexed table does
a little more work in its own transaction. A migration that rebuilds an indexed table must recreate
that table's triggers. A ranked read of an unselective word costs in proportion to the records
containing it, so a surface that takes free text from a person bounds that itself. The fill runs
inside the migration, which is right for today's firms and is the thing to move before a firm with
around a million indexed records applies it.
