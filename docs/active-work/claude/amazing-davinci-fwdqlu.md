---
worktree: (none — this stream runs in a remote checkout of the branch)
area: Tasks — the list becomes the platform's one table, a task carries its people in four roles and a flat checklist, the due time shows its zone, and the attachments picker is fixed
status: review
touches: packages/tasks, packages/database (matter_task_participant, matter_task_checklist_item, one per-firm migration), packages/identifiers, packages/data-access/src/pii-registry.ts, packages/notifications/src/registry.ts, packages/calendar/src/sources/all.ts, packages/fixtures/src/load-profile, apps/api-worker/src/routes/tasks.ts, apps/api-worker/openapi, packages/api-client, apps/web/src/lib/matters (task-list, task-record-window, task-columns, task-people-fields, task-checklist, tasks-api), packages/design-system/src/lib/components/record-attachments, docs/user/features/tasks.md, docs/conventions/design-corrections.md, roadmap.d/tasks.md, status.d/6-3-tasks.md, changelog.d/, docs/decisions/pending/
---

Answers the owner's 2026-09-16 review of the deployed tasks surface in one change, on the design in
`docs/specs/2026-09-16-tasks-table-people-and-checklist-design.md`. The parts a concurrent stream
should not step on: `matter_task.assignee_user_id` is retired (nothing may read or write it; the
people are in `matter_task_participant`); `RecordAttachments` now renders its sources above the
list, which every record window inherits; and `docs/conventions/design-corrections.md` gains a
2026-09-16 tasks entry — coordinate before editing that file. The per-firm migration is
`20260916T120000_task-participants-and-checklist`, re-stamp it if `main` gains a later one before
this lands.
