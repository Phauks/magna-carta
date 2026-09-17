---
worktree: C:/dev/magna-carta-worktrees/claude/adoring-lamport-6yrtjt
area: The calendar day recipe — today, selection, and outside-month days
status: review
touches: packages/design-system/src/lib/components/calendar, packages/design-system/src/lib/components/date-range-picker, apps/web/src/routes/developer-console, apps/web/src/lib/developer, docs/conventions/design-corrections.md
---

Fixes a cascade defect in the month-grid day recipe: the range picker's band states were declared
bare and, imported after `calendar.css`, erased the selected fill on every calendar in the product.
Scopes them, gives today a ring that composes with selection, shades outside-month days, and adds
the dev-only gallery that makes the today-and-selected pair reviewable on any day. Anything else
touching `calendar.css`, `date-range-picker.css`, or the developer-console fixture list should
expect a conflict.
