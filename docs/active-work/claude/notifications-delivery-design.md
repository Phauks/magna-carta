---
branch: claude/notifications-delivery-design
worktree: .claude/worktrees/agent-a29715210eae9d91a
area: Notifications — the delivery half (the record, the channels, preferences, delivery mechanics, and the delivery-time wall)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream settling how a raised notification reaches a person. The registry concept and the
emission points both predate this stream: thirty-one outbox topics already commit transactionally
beside the writes that produce them, the calendar declares six emission points wired to nothing, the
custody register exposes one query-shaped collection point serving two reminder reasons, and the
email-filing package holds one no-op raise site. This stream extends those rather than growing a
parallel path, and writes two specs, one decision fragment, and one changelog fragment. **No product
code in this stream** — nothing under `packages/` or `apps/` is touched.

What it settles: the notification record (a per-firm event row, a per-recipient row, and a
per-channel delivery row, carrying identifiers and declared enum facts and no free text); the two
channels (an in-app read API and an email digest through the platform's own `SendEmail` port); the
preference model on the shipped `scoped_setting` chain, with a firm policy floor that binds
categories and never forces a channel off-platform; the delivery mechanics (subscribe to the shipped
outbox rather than adding a second transactional write, a per-firm scheduled sweep for the
comparison-shaped emission points, keyset digest composition, idempotent delivery, and a ninety-day
retention sweep); and the wall enforced at delivery time through the one visible-matter predicate the
calendar already composes.

What it does not settle or build: any user interface, web push, SMS, desktop-native presentation, and
external calendar or webhook integration — each a named seam.

## Overlap to watch

- **`packages/calendar/src/notifications.ts`** (six declared emission points) and
  **`packages/custodian/src/reminders.ts`** (the one collection point) are read, quoted, and
  subscribed to by the plan's build slices. Neither is edited in this stream.
- **The build slices named in the plan** would add one package (`@magna-carta/notifications`), four
  per-firm tables, four identifier prefixes, one capability, three calendar outbox topics on the
  calendar's own write paths, and one non-exclusive pass in the per-firm queue dispatcher
  (`apps/worker/src/costs/recoverable-charge-consumer.ts`). Nothing here writes any of them.
- **Any stream touching the per-firm queue dispatch table or the cron sweep** in
  `apps/worker/src/scheduled.ts` should know that the plan's slice 1 adds a subscriber pass to the
  first and slice 2 adds a sweep step to the second.
