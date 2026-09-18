---
category: Changed
audience: public
---

**Downloads is a register on the platform's one table.**

A fixed list of seven columns served a shelf that held one kind of thing. It holds five now — an export, a bundle, a converted file, a discovery production, a file taken off a matter — and they answer different questions, so the columns are declared (`apps/web/src/lib/export/download-columns.ts`) and the reader chooses: sort, per-column filters, show and hide, reorder, pin, and a layout that survives the visit. Type and Standing declare their whole vocabularies rather than reading them off the rows in hand, so a member with no conversions loaded this week is not told the register cannot hold one.

**Standing is the column the screen could not do without.** Now that the row outlives the bytes, "is this still here" stopped being answerable from the other columns: Available, Preparing, On the matter, and Record only are four different answers to "can I have it again", and the Download control is offered from the same reading.

**The read is paged and the search is the server's.** `GET /api/v1/downloads` answers the house `{ data, nextCursor }` envelope and takes a `search` that narrows the whole register — the register has no bound now, so filtering the rows a client happens to hold would answer confidently about a fraction of it. Taking several at once routes by kind rather than by "artifact or not": snapshots render into one archive, a matter file and a stored artifact each open on their own, and a record that never held bytes is reported as short rather than silently missing from the zip.

## Public

**Your Downloads screen is now a proper table.** Sort it, filter it, and turn on the columns you want — the size, the format a report was made for, the day a copy stops being available — and it remembers how you arranged it. Search finds anything you have ever downloaded, not just what is on screen, and every row says plainly whether you can still have it.
