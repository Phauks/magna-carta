---
category: Fixed
audience: internal
---

**Asking for a matter's time answered with its drafts, and nothing said so.** The per-matter listing
defaulted its status filter to `draft` when the caller named none. The contract declares that
parameter optional with no default and no note, so a client reading it would expect the matter's
time record; what came back excluded every entry that had been submitted, approved, invoiced or
voided. A matter with a year of billed work read as nearly empty.

An absent status now means every status, which is what a matter's time record is. Narrowing to one
is still available and is the work-in-progress question, asked by a different caller for a different
reason; the contract now says which is which.

The listing also resolves the timekeeper's name in the same statement rather than answering with the
identifier. A matter with forty entries would otherwise be forty reads to print one column. The join
is outer: a member can be archived while the time they recorded stays on the matter, and that reads
as an honest absence rather than a user handle where a person's name belongs.

The Time section is built over the repaired read, replacing a fixture table. It shows the status of
every entry, because a voided line and a billed line are not the same fact, and it totals only the
billable time that still counts. Starting a timer from the screen waits on the timer surface and
renders as an affordance that says so.
