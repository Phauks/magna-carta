---
worktree: C:/dev/magna-carta-worktrees/claude/wizardly-pasteur-ksiaxq
area: Tasks — one record window reads and changes a task; its state becomes four rungs plus archive, and the schema route for that is a fleet-wide ADR
status: review
touches: packages/database, packages/tasks, packages/fixtures, apps/api-worker, apps/web/src/lib/matters, apps/web/src/lib/time, apps/web/test, docs/conventions/design-corrections.md, docs/user/features/tasks.md, docs/decisions/pending, changelog.d
---

Two rounds. First the task surface moved onto the product's one record window — it reads a task,
edits it in place, and opens empty-with-fields for a new one — and nothing unfolds inside the list any
more. Then the state model: To Do / In Progress / On Hold / Done, with archive and delete as the two
ways out, replacing open/done/cancelled.

**Touches the per-firm schema and the migration lineage**, so a concurrent stream adding a per-firm
migration should sync before authoring one: `20260914T120000_task-rungs-and-archive` is journal entry 8. It is additive — `matter_task` is a parent table, and widening its `state` CHECK is the rebuild a
durable object refuses at the commit. That finding is now
ADR-0461 and a rule in
`packages/database/CLAUDE.md`, because it binds every table anything references, not just this one.
