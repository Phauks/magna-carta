---
category: Added
audience: public
---

**The period ledger at `/time`, and the cross-matter listing that had to exist first.** The sidebar's Time row was an announced Soon stub for a structural reason rather than a cosmetic one: `GET /api/v1/time-entries` answered one timekeeper on one day, or one matter entire, and returned an empty list for anything else. The top bar's firm-wide Time Sheet was therefore reading nothing at all, and flipping `shipped` would have linked to a screen with no read behind it.

The third listing shape closes that: a `from`/`to` span of work dates across every matter, narrowable to one timekeeper, matter or status, cursor-paged on the same `(work_date, id)` key the per-matter read walks so a cursor means one thing on both. `listTimeEntriesInRange` in `packages/timekeeping/src/queries.ts`; one added index (`time_entry_work_date_index`), because the unnarrowed span had no work-date-leading index to ride.

A period naming no timekeeper asks for the firm's whole record and is gated on `time:viewFirm`; naming somebody else is gated identically. Defaulting an ungated caller to themselves was considered and rejected — a listing that silently answers a narrower question than it was asked is the defect the per-matter status default already was. A span that reads backwards is refused rather than swapped.

The screen reuses what the matter's Time tab already had: the one grid, the entry record window, the status register, and the scope arithmetic the Time Sheet uses (which gains last-week and the two month spans — one function, two menus). It adds a Matter column, resolved client-side against the firm's matters rather than denormalized onto the row, and the period totals. Deliberately no free-text search: the period pages, and a box covering only the loaded rows would report a word missing from a month it never read.

## Public

**Time in the sidebar now opens.** It shows the firm's time over a period — every hour recorded, across every matter and every timekeeper, for the days you choose.

Pick a span: today, yesterday, this week or last, this month or last, or any range on the calendar. Pick whose: your own by default, and, where your account may read the firm's time, any colleague or everyone at once. Both choices are in the address, so a partner looking at somebody's month sends that view by sending the link.

The strip under the table says what the period holds — hours recorded, how much of it bills, what is still unbilled and what an invoice has taken up — and follows your filters, so narrowing to one matter makes the figures speak for that matter. Every column carries its own filter, reached from the column's own heading, and the counts say how much they left out. A row opens the same entry record the matter's Time tab opens.

This is the read surface. Capture has not moved: the Time Sheet in the top bar still opens over whatever screen you are on, so writing a row never costs you your place. The week grid — matters down the side, days across the top — is the other half of this screen and is still to come.
