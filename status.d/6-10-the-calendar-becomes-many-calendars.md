---
slice: 6·10 — The calendar becomes many calendars
group: phase-6
order: 10
research: n/a
spec: done
plan: n/a
built: done
ui: done
load-profile: n/a
tested: done
branch: claude/modest-knuth-lvlzpt
active-work:
next: The rail's order is the catalog's, not the reader's — dragging a calendar, and a saved arrangement, are the obvious next ask; file-destruction dates are listed and refused until a retention schedule exists; a member calendar carries settings and not deadlines, because the deadlines read has no member predicate
link-spec: docs/specs/2026-09-02-calendar-interface-design.md
link-plan:
adrs:
blocked-by:
---

The owner's review round of 2026-09-14, eleven corrections, built through every layer. The firm
calendar stops being one grid: a **catalog of individual calendars in folders** (the firm's own two,
a folder per role the firm handed out, the rooms, everything else booked, the dates) with a
three-state control per folder, and a **read plan per calendar** — a member calendar is the member
filter the server already resolves in SQL, a room calendar the availability read, a date calendar
the federated read narrowed to that layer. A calendar that is off is no read at all, so the request
count is the reader's choice rather than the roster's size; the same record from two of them merges
into one row that knows it is on both. Which calendars are on, and what colour each wears, is
**personal and per browser** (the week start stays the firm's, on the server) and stores only the
departures from the catalog's defaults, so a calendar shipped later arrives at its own.

**`CalendarGrid.Day`**, the fourth presentation and the only one with a time axis: an hour per row,
a calendar per column, an all-day band above the hours, and the range widened by anything outside
the working day. A record on two calendars is drawn in both columns deliberately. It is fed by the
one thing the federated read was missing — **the hour**: `TimelineEntry` gains `timeOfDay` and
`timeZone`, declared per source, the same class of fact as the sort key and never converted. Before
this the firm-wide grid painted no times at all.

**One palette, one home** (`packages/design-system/src/lib/palette/`): the eleven colours the folder
rail offered, their fills as `--mc-palette-*`, `FOLDER_COLORS` re-exporting them unchanged, and
`PaletteSwatches` as the one control. A calendar offers the nine that read on a chip and wears its
colour as a leading rule, so the status register keeps the fill and a cancelled setting stays
visibly cancelled.

**The record forms**: Where becomes Location as the dropdown-with-add over the firm's own offices
and rooms; a **conference link** gets its own field and its own nullable column on `matter_event`
and `firm_event`; the times become time fields with the zone beside them as a shortcode worked out
on the record's own day; the day being booked stands in the panel's context pane as the product's
own calendar with a day view; double-clicking an empty day or hour opens the form on it; and the
**matter stops being required** — no matter is a choice whose row says what it writes, and the form
writes a firm event, which is the table an event belonging to no case already had. Two lines come
off: "A matter is needed." with the requirement, and "Nothing recorded in September 2026." from
every grid, because a month that is empty says so by being empty.
