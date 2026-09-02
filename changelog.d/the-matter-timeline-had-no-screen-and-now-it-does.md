---
category: Added
audience: public
---

The matter's Activity section: fourteen subsystems' worth of history, in order, on one screen.

The federated timeline has been built, tested and served since the calendar slice — `GET /api/v1/matters/{matterId}/timeline`, fourteen declared sources read in place under one sort key, one cursor and one visibility contract, with nothing projected or copied. **Nothing in the web app called it.** The matter's story was scattered across the sections that each hold a piece of it, and the read that puts it back together answered to no screen.

**The screen names no source and switches on none.** `packages/calendar/src/sources/all.ts` declares where a source's rows live and whether it has a non-privileged label, and deliberately says nothing about presentation; `apps/web/src/lib/matters/activity-presentation.ts` is the other half — one entry per source key, carrying the sentence, the band it filters under, its glyph, and what its declared label actually means. Adding a subsystem to the platform's timeline is one entry there, and `activity-presentation.test.ts` scans the calendar package's own declarations and fails until it exists, so a new source cannot reach a person's screen as an unexplained row.

**The rows are thin because the confidentiality design makes them thin.** Most sources declare no label at all — a note's first eight words and an email's subject line are exactly the disclosure a read spanning a whole matter must not make — so an entry states what happened, when and by whom, and the words stay behind the link, one authenticated request into the subsystem that owns them. Where a source does declare a label the screen names the FIELD beside it, because a document's type set beside a document row reads as the file's name unless something says which fact it is.

The filter narrows the read rather than the rows: pressing a band sends the source keys with the request, and the server narrows its registry before it builds a statement, so a filtered chronology is one statement per named source instead of one per source in the platform. Entries are cut into days by the first ten characters of the sort key rather than by parsing it, because half the sources sort by a civil date and half by an instant, and reading an instant into a date to format it back would move a filing to the day before for every reader west of the zone it was written in.

**A row leads with what the thing is called.** The federated read still projects almost nothing — that is the confidentiality design and it is unchanged — so the screen follows the deep link eagerly instead: for the rows on the page it reads each owning subsystem's own access-gated listing, the same read a person could make by opening that section themselves, and joins on the row identity the timeline already carries. A document row leads with its file name and states its size, its version and whether it is quarantined; a note row leads with its opening line. One bounded read per subsystem per matter, kept across pages, and a subsystem that refuses costs its own rows their extra line and nothing else. Adding the next one is a single loader in `activity-detail.svelte.ts`.

**Nothing says a document was "filed".** To a lawyer, filing means filing with a court, and this platform files nothing with a court: a document is added to the matter, an email is saved to it. The source keys stay `documentFiled` and `emailFiled` because they are wire contracts — which is exactly why the words a person reads are decided at the presentation layer and not taken from them. The standing rule is in `docs/conventions/design-corrections.md`; the word remains correct in its own sense, as in a filing fee or a filing deadline, and the test is whether a court is on the other end of it.

**The filter starts at All and takes any number of bands at once**, beside Any time / Past / Upcoming and a From and To date. Every one of them narrows the read rather than the rows.

Two deep links were repaired on the way. `emailFiled` pointed at a matter section spelled `email` and the three custody sources at `custody`; the app routes `emails` and `custodian`, so every one of those entries would have landed on a screen that does not exist. A conflicts check has no matter section at all, so its entries state what happened and offer nowhere to go — the screen asks the section registry whether a target is built rather than keeping a second list of which links work.

## Public

**See everything that has happened on a case, in one place.** The matter's new Activity section is the whole story in date order: email saved to the matter, documents added and assembled, hearings and deadlines, time and costs booked, client money moved, items in your custody, conflicts checks, the notes your firm wrote, and the day the matter opened. It is the screen to open when you pick up a file you have not touched in months, and the one to read from when you need to account for what was done and when.

**Every entry says what the thing is.** A document row gives you the file name, how big it is, which version, and whether the scanner has held it back. A note row gives you its opening line. You can read the case down the page without opening anything.

**Narrow it to what you are looking for.** Start at All, then press any combination of Written Record, Documents & Mail, Dates, Money, Property, and The Matter Itself. Split it by Past or Upcoming, or set a date range. Clear Filters puts it back.

**Follow anything into the record behind it.** Each entry opens the thing it describes, in the section that holds it, with everything that section holds about it.

**"Added" is not "filed".** A document added to the matter's own record has not been filed anywhere: filing means filing with a court, and Magna Carta files nothing with a court on your behalf. The word appears here only in its own sense, as in a filing fee or a filing deadline.
