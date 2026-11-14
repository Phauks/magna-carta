---
slug: a-draft-number-is-held-for-its-panel-and-given-back-on-cancel
status: Accepted
area: Platform
date: 2026-11-14
summary: "A panel creating a numbered record holds the number it will be saved under (number_reservation), renews it while open, and gives it back on cancel or after fifteen minutes. The draw planner takes the holder's own value, then the lowest value given back, before moving the counter, so no run keeps a gap. Invoice and time entry numbers are not held."
---

**A draft number is held for its panel and given back on cancel.**

**Context:** The owner, 2026-11-14: "remove 'A number is drawn when this is saved.' In general,
whenever something is being created, show the draft number, and if it is not saved, then rescind the
number." Until then a panel showed a preview of what the next record would take (the call log and the
new conflicts check) or the sentence above (every other panel), and nothing was held, so two people
could read out the same number and only one record would get it.

**Decision.** The author's recommendation, built on the owner's instruction to proceed while away.

1. **One table holds every run's draft numbers**, `number_reservation`, keyed by purpose, scope and
   counter value. A row with a token is held by one member until it lapses; a row without one was
   given back.
2. **Holding moves the counter**, guarded on the value read, with the hold written first; two panels
   reaching for one value are separated by the table's primary key.
3. **The draw planner reads holds before the counter.** A draw carrying its panel's token takes that
   value and deletes the hold in the record's own batch instead of advancing the counter. A draw of
   one with no token takes the lowest given-back or lapsed value in its scope first. So a run has a
   gap only while a value is held or waiting, and the next record fills it.
4. **A hold lapses after fifteen minutes unrenewed.** An open panel renews every five; a lost tab
   never needs to say it closed.
5. **One display format.** A draft number is the `draft` standing on the record reference and renders
   in italics, everywhere, with its meaning on the number. The sentence and the `preview` standing are
   retired, and so is the conflicts check's next-number route.
6. **Invoice and time entry numbers are not held.** The register says so per purpose
   (`draftNumber: "previewed"`). An invoice run is read by auditors as gapless AND in issue order;
   giving a number back breaks the second, and finalize already numbers a bill in one batch with
   nothing to give back. Time entries are captured in blocks with no panel.

**Consequences.** A run that holds draft numbers is gapless but no longer strictly in creation order:
a given-back number is taken by a later record. That is acceptable for matter, consultation, intake,
conflicts check, custody packet and call numbers, and is the reason invoices are excluded. A plain
draw that reads the counter in the same millisecond a hold advances it can take the held value; the
allocation key still refuses a duplicate, and the holder's save is given the next free number, so
the only cost is a draft number that changes at the save. An "Open Matter" draft number renders only
where the firm's matter scheme can be rendered from what the window knows (the client name and the
practice area code); a scheme that needs the office code or staff initials shows the kind alone until
saved.
