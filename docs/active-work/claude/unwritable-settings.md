---
worktree: .claude/worktrees/agent-a719f1c2048eef0b8 (agent worktree)
area: Notifications — the firm's notification policy (the in-app floor, retention window, digest hour), and a probe for exported writes with no production caller
status: building
touches: apps/worker/src/routes/firm-notification-policy.ts, apps/worker/src/routes/notification-preferences.ts, apps/worker/src/app.ts, apps/worker/test/, apps/worker/openapi/openapi.json, packages/api-client/, packages/notifications/src/preferences.ts, packages/notifications/CLAUDE.md, packages/access-control/src/registry.ts, packages/database/drizzle/per-firm/, tooling/lint-unwired-writes/, package.json, docs/user/features/, roadmap.d/, status.d/, STATUS.md, changelog.d/, docs/decisions/pending/
---

Three writers in `@magna-carta/notifications` had no production caller: the **firm tier** of the
preference matrix (the in-app floor a member may not lower), the notification **retention window**,
and the **digest local hour**. All three are read at evaluation time — the floor by every fan-out,
the window by the nightly retention sweep, the hour by the hourly digest pass — and no firm could set
any of them. `PATCH /api/v1/notifications/preferences` writes the member's own matrix and the
trust-compliance designation, and never the firm one.

This stream builds `GET`/`PATCH /api/v1/firm/notifications/policy` behind a new
`firm:manageNotificationPolicy` seeded to Owner/Admin — deliberately **not** the member key
`notifications:read`, which every default role including Read-only carries, and which would let any
member raise the floor and change retention for the whole firm.

Also here: the probe that found them, measured against the whole tree and kept as
`pnpm run lint:unwired-writes` with a per-entry-reasoned allowlist.

Concurrent streams: `apps/worker/openapi/openapi.json` is a declared overlap with
`claude/auto-file-management` and `claude/passive-dev-orchestrator-m7f9jw`. It is a generated
snapshot — re-emit, never hand-merge.
