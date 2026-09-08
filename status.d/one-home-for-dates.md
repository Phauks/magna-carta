---
slice: One home for dates
group: cross-cutting
order: 41
research: n/a
spec: n/a
plan: n/a
built: done by="Opus 5"
ui: n/a
load-profile: n/a
tested: done by="Opus 5"
branch: claude/date-handling-audit-xx8q3o
active-work: docs/active-work/claude/date-handling-audit-xx8q3o.md
next: Owner call on whether the fifteen surfaces still on a native date input move to the DatePicker
link-spec:
link-plan:
adrs: ADR-a-date-has-two-authorities-and-a-gate-that-keeps-it-so
blocked-by:
---

`@magna-carta/civil-time` (shape) + the design system's `formatters/` (display), with `lint:date-handling` holding the line; about seventy duplicates removed, two of which had already drifted.
