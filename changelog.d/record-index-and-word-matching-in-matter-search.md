---
category: Changed
audience: public
---

**The text a firm holds in its records is now indexed, and matter search reads that index for prose.** A per-firm migration adds the record index: `record_text_entry` and the contentless full-text table `record_text_fts`, kept current only by triggers on `matter_note`, `time_entry`, `cost_entry`, `matter_event`, `communication`, `matter_task`, `magnus_conversation` and `magnus_turn`, and filled in the same migration for records that already exist. The sources are declared once in `packages/search/src/record-index-sources.ts` and everything else is rendered from them. `packages/matter-search` now matches notes, time, costs, calendar and the words of a call or text through the index; files, folders, parties, custody, billing and telephone numbers still match by substring. Tasks and Magnus conversations are indexed and have no reader yet. Design: `docs/specs/2026-11-10-indexing-and-discovery-design.md`.

## Public

**Searching a matter now matches whole words in notes, time, costs, calendar and messaging.** Type several words and a record is found when it contains all of them, wherever they fall. The last word you type can be the start of a word, quotation marks find an exact phrase, and capital letters and accents no longer matter. A fragment from the middle of a word no longer matches in those sections. File names, party names, custody numbers, invoice numbers and telephone numbers are still found by any part of them.
