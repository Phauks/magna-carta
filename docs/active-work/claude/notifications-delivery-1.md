---
branch: claude/notifications-delivery-1
worktree: /home/user/magna-carta/.claude/worktrees/agent-a10ebc3b6bfb382bc
area: Notifications delivery slice 1 — the record, the registry, the subscriber, the member read API
status: building
touches: packages/notifications, packages/identifiers, packages/database (per-firm schema + migration 20260807T020000), packages/data-access/src/pii-registry.ts, packages/access-control/src/registry.ts, packages/matters, packages/file-manager, apps/worker (routes/notifications.ts, costs/recoverable-charge-consumer.ts, scheduled.ts, per-firm-migrations.ts, openapi snapshot), packages/api-client (generated), changelog.d, status.d, docs/decisions/pending
---

Builds the delivery half's first slice: four per-firm notification tables, the type registry with its
closed fact grammar, a second non-exclusive translator pass on the shipped per-firm queue dispatcher,
and the member-scoped read API (feed page, unread count, mark read/dismiss/read-all). Adds the
`notifications:read` capability seeded to every default role, the firm-ceiling email detail-level
setting shape, and the firm-configurable retention window with its nightly sweep.

**Holds per-firm migration tag `20260807T020000_notifications-delivery` (journal idx 44).** A
concurrent migration-bearing stream must take a later tag, or retag dense if it merges first.

Also touches the producing packages `@magna-carta/matters` and `@magna-carta/file-manager` to export
their outbox topic names as constants (no behaviour change — the literal moves into an exported
const so the notification registry cannot spell a topic differently from its producer), and
`apps/worker/src/routes/incidents.ts` for the same reason.
