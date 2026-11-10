---
worktree: cloud session (no local worktree)
area: Two-way calendar sync with Outlook, then Google Calendar
status: building
touches: packages/calendar, packages/microsoft-graph, packages/integrations, packages/design-system, packages/database, packages/data-access, apps/api-worker, apps/web/src/routes/(app)/settings, docs/specs/2026-11-10-calendar-sync-design.md, docs/integrations.md, ROADMAP.md, roadmap.d/calendar.md, docs/deploy-queue.md, apps/web/src/lib/settings/settings-sections.ts, docs/conventions/design-corrections.md
---

Calendar sync with Outlook, built in several pull requests from this one branch: the design of record,
a reusable permission request window, connecting an account, sync rules and events out, changes back,
repeating events, then Google Calendar. No column changes to `matter_event` or `firm_event`; `integration_connection` gains one
nullable column. It does not edit `recurrence-field.svelte`, the series expansion or the scope dialog
in `entry-window.svelte`, which the recurring-events stream owns. Email sync is out of scope.
