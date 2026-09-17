---
worktree: C:/dev/magna-carta-worktrees/claude/adoring-lamport-6yrtjt
area: The calendar's participant role becomes the product's dropdown-with-add
status: review
touches: apps/web/src/lib/calendar, apps/web/test, docs/conventions/design-corrections.md
---

Carries the already-promoted dropdown-with-add rule over to the one field on the event form that
had not caught up: the participant's role, which was a bare text box. Adds
`participant-role-field.svelte`, the offered vocabulary and the casing collapse in
`calendar-vocabulary.ts`, and a ruling round in `design-corrections.md`. Anything else touching the
calendar's record form or that ledger should expect a conflict.
