---
slice: One home for dates — the second pass
group: cross-cutting
order: 42
research: n/a
spec: n/a
plan: n/a
built: done by="Opus 5"
ui: done by="Opus 5"
load-profile: n/a
tested: done by="Opus 5"
branch: claude/date-handling-audit-xx8q3o
active-work: docs/active-work/claude/date-handling-audit-xx8q3o.md
next: Owner call on the picker's own wrapper — thirteen consumers wrap it to keep the label and the field in one grid track, and the wrapper's gap adds to the label's margin, so the label-to-field distance is 8px on some surfaces and 12px on others
link-spec:
link-plan:
adrs: ADR-a-date-has-two-authorities-and-a-gate-that-keeps-it-so
blocked-by:
---

Six more wrong-day surfaces in the spelling the first pass missed, the gate rule that reads the argument rather than the operation, and the print-sheet formatting seam collapsed from seven declarations to one.

And the owner's ruling that followed: every native date input is the DatePicker now, the gate's allowance list is empty and asserted empty, and the picker gained the Input's size scale, an `aria-label`/`aria-invalid` that reach the segment group, and the CalendarDate/text conversion moved beside it.
