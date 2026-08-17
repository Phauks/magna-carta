---
worktree: /home/user/magna-carta/.claude/worktrees/notification-dedupe
area: notifications — what the dedupe key guarantees once retention deletes the row it lives on, and the uncounted clamp in the comparison sweep's zone discovery
status: building
touches: packages/notifications/src/materialize.ts, packages/notifications/src/registry.ts, packages/notifications/src/sweep.ts, packages/notifications/src/retention.ts, packages/notifications/test, packages/notifications/CLAUDE.md, apps/worker/src/scheduled.ts, status.d, changelog.d, docs/decisions/pending, roadmap.d, STATUS.md, STATUS.json, docs/now.md
---

Resolving whether `notification_event.dedupe_key`'s UNIQUE index disappearing with the retention
sweep is the intended contract or a defect, then implementing the answer. The evidence says intended:
the key is a duplicate-suppression floor whose required lifetime is each production path's redelivery
horizon, every one of which is far shorter than the thirty-day retention floor, and the platform
already routes once-per-subject-forever convergence into the owning subsystem's own tables. The work
is therefore to name and enforce that boundary where it belongs rather than to build a durable key
table, plus to close the one genuinely silent clamp in the comparison sweep.

Nothing here changes a firm-observable behaviour. Concurrent streams should not need to touch
`packages/notifications`; I do not touch `tooling/`, `.github/workflows/gate.yml`,
`packages/billing/CLAUDE.md`, or `packages/database/CLAUDE.md`, and I add no table or column.
