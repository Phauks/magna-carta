---
category: Fixed
audience: public
---

**The Directory has a listing.** It never had one: the screen was designed to be searched and not browsed, so `MINIMUM_QUERY_LENGTH` characters had to be typed before anything appeared, and a firm that had entered twenty clients opened it to an instruction. The reasoning was half right — a ranked, capped answer must never be dressed as an index — and drew the wrong conclusion; the answer is to build the index.

`GET /api/v1/directory/entities` is the new read: both node tables unioned into one sequence, ordered by a name key computed per table so a row never sorts under one name and prints another, cursor-paged over `(sort name, id)` through the existing opaque token, and carrying `total` for the whole record rather than the page. `kind` narrows it. Deleted and merged-away records are excluded. It lives in `packages/directory/src/entity-listing.ts` and reaches the firm database through the chokepoint like every other directory read. The ordering key is computed rather than stored, so the read scans the node tables; a stored normalized sort column is the change if that ever stops being cheap enough.

The screen now shows the index at rest and the search answer only when a query is asked, as two visibly different objects: the index is the platform's one table (sortable, filterable, paged, counted), and the search answer keeps the firm's relevance order, is never re-sorted client-side, and keeps its capped line.

## Public

**The Directory now opens on your firm's records instead of on an instruction to search.**

There are two shapes on the screen and they are different things. The listing is your whole directory in name order, walked a page at a time, and it says how many records the firm holds. A search answer is in the firm's own relevance order and says when the firm holds more matches than are shown.

People and organizations sit in one listing, because the directory is one book and somebody looking for a name does not know in advance which the firm filed them under. Kind is a column and a filter rather than a second screen. A record folded into another is not listed: its names still find it and still lead to the surviving record, but listing it beside that record would show one client as two.
