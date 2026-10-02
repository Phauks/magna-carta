---
number: 442
slug: a-period-is-the-third-listing-shape-and-the-firms-span-is-a-capability
status: Accepted
date: 2026-09-06
area: Time tracking
summary: "Time gains a third listing shape — a `from`/`to` span of work dates across every matter — because neither of the two that existed could answer what went on the record this week. A span naming no timekeeper is the firm's whole record and requires `time:viewFirm`; naming somebody other than the caller requires it too; an ungated caller is refused rather than silently narrowed to themselves. The period ledger at `/time` is built on it, narrows through the one grid's own column filters rather than a free-text box, and states its figures over what is loaded."
---

**A period is a question the day read and the matter read cannot answer between them, and asking it
about somebody else is a capability rather than a default.**

**Context:** the sidebar's Time row had been an announced Soon stub since the destination registry
was written, and the personal-timesheet design of 2026-08-25 had planned `/time` as the place a
timekeeper reviews a period. Nothing had been built there, and the reason was underneath the screen:
`GET /api/v1/time-entries` answered one timekeeper on one work date, or one matter entire, and
returned an empty list for anything else — correctly, because the alternative was a full-table scan.
The consequence was quieter than a missing screen. The Time Sheet in the top bar had shipped as the
firm's capture surface, reading `listTimeEntries` with no matter, and that read was answering with
nothing at all. A surface asking a question the contract had no shape for is indistinguishable, on
screen, from a firm with no time on its record.

**Decision:** the listing takes a third shape. `from` and `to` bound a span of work dates across
every matter, narrowable to one timekeeper, one matter and one status, cursor-paged on `(work_date,
id)` descending — the same total order the per-matter read walks, so a cursor means the same thing on
both. The span is required and the narrowing is not: a listing over all time with no bound is the
scan the empty answer was protecting against. One index is added (`time_entry_work_date_index`),
because the unnarrowed span had no work-date-leading index to ride.

Scope is a capability, checked before the read. A span naming no timekeeper asks for the firm's whole
record for those days and requires `time:viewFirm`; a span naming somebody other than the session
member is the same question about one person and is gated identically. Only a member reading their
own span passes without it. A span that reads backwards is refused with a 422.

`/time` is built on that read. It reuses the product's one grid, the shared entry record window, the
status register and the Time Sheet's own scope arithmetic — which gains last week and the two month
spans, so one function serves both menus. It adds a Matter column, resolved against the firm's
matters on the client, and the period totals. The span and the timekeeper both ride the URL. The
sidebar destination flips to `shipped` at stage `alpha` in the same commit.

**Considered and rejected:** defaulting an ungated caller to their own time, because a listing that
silently answers a narrower question than it was asked is precisely the defect the per-matter
listing's `status: "draft"` default had already been; swapping a backwards span, because a swap hides
a mis-click behind a result nobody asked for; denormalizing the matter number and title onto the
listing row, because the firm's matters are already walked for the record window's picker and a
second copy of a matter's name is a second thing to keep in step; extending `TimeLedger` to serve
both scopes, because its frame is the matter money surface's — a per-matter toolbar and section strip
that a firm-wide screen has no matter to draw; a free-text search box on the screen, because the
period pages and a search covering only the loaded rows would report a word missing from a month it
never read, while the columns' own filters narrow and say how much they left out; and a `matterless`
allowance on the period read, because `time_entry.matter_id` is `NOT NULL` and the nullable-matter
delta belongs to the sheet's own contract work.

**Consequences:** the firm-wide Time Sheet in the top bar now reads something. The period ledger
ships as the list half of the personal-timesheet design; the week grid is the other half and is not
built, and submission stays absent while the firm's review-gate setting is unserved. The figures on
the screen cover what is loaded and the surface says so while a page remains, because a subtotal
presented as a period's whole total is a number somebody would bill from. Spec:
[`docs/specs/2026-08-25-personal-timesheet-design.md`](../../specs/2026-08-25-personal-timesheet-design.md).
