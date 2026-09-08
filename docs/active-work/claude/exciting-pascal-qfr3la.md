---
worktree: C:/dev/magna-carta-worktrees/claude/exciting-pascal-qfr3la
area: The Record Communication panel — two columns, typed choices, a consolidated phone field, start and end times
status: review
touches: apps/web/src/lib/communications, apps/web/src/lib/directory, apps/web/src/lib/components, apps/web/src/lib/time/matter-picker.svelte, apps/web/static/flags, packages/design-system/src/lib/components/entity-picker, packages/design-system/src/lib/components/textarea, docs/conventions/design-corrections.md, tooling/lint-one-ui/registry.json, STATUS.md
---

The owner's second review round on the messaging form (2026-09-08). The panel becomes Record
Communication: quantitative fields on the left, what was said on the right, every closed choice a
combobox rather than a select, and the country and the number entered in one field shared with the
Directory's contact rows. Touches `matter-picker.svelte` (it gains answers that are not matters) and
two design-system components (Textarea's grab corner, EntityPicker's beside-field New) — both by
adding an off-by-default prop, so no other surface moves.
