---
branch: claude/notifications-2
worktree: .claude/worktrees/notifications-2
area: Notifications delivery slice 2 — the comparison-driven path, and the emission points missing a write
status: building
touches: packages/calendar/src/notifications.ts, packages/calendar/src/event-service.ts, packages/calendar/src/continuance-service.ts, packages/calendar/test/, packages/notifications/, apps/worker/src/scheduled.ts, apps/worker/src/index.ts, apps/worker/src/assemblies/, apps/worker/src/recovery/, apps/worker/test/, changelog.d/, docs/decisions/pending/, roadmap.d/notifications.md, status.d/, docs/deploy-queue.md, docs/active-work/
---

Slice 2 of notifications delivery, per
[`docs/specs/2026-08-06-notifications-delivery-implementation-plan.md`](../../specs/2026-08-06-notifications-delivery-implementation-plan.md).
The comparison-driven production path, plus the calendar write paths that had no transactional
announcement.

- **Three calendar write-path topics** — `calendar.event.scheduled`, `.rescheduled`, `.cancelled`,
  spelled once in `packages/calendar/src/notifications.ts` and emitted as outbox rows in the batch
  the record / edit / cancel / continue effects were already composing. `rescheduled` fires on a
  move, not on every edit.
- **The per-firm comparison sweep** — `runNotificationComparisonSweep` on the daily cron pass, over
  the same `listReachableActiveFirms` enumeration, calling the calendar's shipped overdue/due
  comparisons and `collectCustodyReminders` rather than a second definition of what is due. Bucketed
  by civil date in the deadline's own zone.
- **Job-coordinator completion rows** — the document-assembly and recovery coordinators, the two
  that record who asked for the job.

Retention (plan task 2.4) and the email-filing topic (task 2.2) already shipped; this stream verifies
them rather than rebuilding them.
