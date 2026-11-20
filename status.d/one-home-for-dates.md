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
active-work:
next: Answered — every date is entered through the DatePicker (owner, 2026-09-08); what is open now is on the continued slice
link-spec:
link-plan:
adrs: ADR-0449
blocked-by:
---

`@magna-carta/civil-time` (shape) + the design system's `formatters/` (display), with `lint:date-handling` holding the line; about seventy duplicates removed, two of which had already drifted.
