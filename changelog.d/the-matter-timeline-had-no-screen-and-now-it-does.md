---
category: Added
audience: public
---

The matter's Activity section: fourteen subsystems' worth of history, in order, on one screen.

The federated timeline has been built, tested and served since the calendar slice — `GET /api/v1/matters/{matterId}/timeline`, fourteen declared sources read in place under one sort key, one cursor and one visibility contract, with nothing projected or copied. **Nothing in the web app called it.** The matter's story was scattered across the sections that each hold a piece of it, and the read that puts it back together answered to no screen.

**The screen names no source and switches on none.** `packages/calendar/src/sources/all.ts` declares where a source's rows live and whether it has a non-privileged label, and deliberately says nothing about presentation; `apps/web/src/lib/matters/activity-presentation.ts` is the other half — one entry per source key, carrying the sentence, the band it filters under, its glyph, and what its declared label actually means. Adding a subsystem to the platform's timeline is one entry there, and `activity-presentation.test.ts` scans the calendar package's own declarations and fails until it exists, so a new source cannot reach a person's screen as an unexplained row.

**The rows are thin because the confidentiality design makes them thin.** Most sources declare no label at all — a note's first eight words and an email's subject line are exactly the disclosure a read spanning a whole matter must not make — so an entry states what happened, when and by whom, and the words stay behind the link, one authenticated request into the subsystem that owns them. Where a source does declare a label the screen names the FIELD beside it, because a document's type set next to "A document was filed" reads as the file's name unless something says which fact it is.

The filter narrows the read rather than the rows: pressing a band sends the source keys with the request, and the server narrows its registry before it builds a statement, so a filtered chronology is one statement per named source instead of one per source in the platform. Entries are cut into days by the first ten characters of the sort key rather than by parsing it, because half the sources sort by a civil date and half by an instant, and reading an instant into a date to format it back would move a filing to the day before for every reader west of the zone it was written in.

Two deep links were repaired on the way. `emailFiled` pointed at a matter section spelled `email` and the three custody sources at `custody`; the app routes `emails` and `custodian`, so every one of those entries would have landed on a screen that does not exist. A conflicts check has no matter section at all, so its entries state what happened and offer nowhere to go — the screen asks the section registry whether a target is built rather than keeping a second list of which links work.

## Public

**See everything that has happened on a case, in one place.** The matter's new Activity section is the whole story in date order: mail filed, documents filed and assembled, hearings and deadlines, time and costs booked, client money moved, items in your custody, conflicts checks, the notes your firm wrote, and the day the matter opened. It is the screen to open when you pick up a file you have not touched in months, and the one to read from when you need to account for what was done and when.

**Narrow it to what you are looking for.** Written Record, Documents & Mail, Dates, Money, Property, or The Matter Itself. Nothing pressed shows everything.

**Follow anything into the record behind it.** Each entry opens the thing it describes, in the section that holds it, with its full detail. Entries themselves stay deliberately brief: what happened, when, and who did it. Nothing a matter's history says out loud is content a client, a note or a message would not want said out loud.
