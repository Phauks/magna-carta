---
branch: claude/notifications-3
worktree: .claude/worktrees/notifications-3
area: Notifications delivery slice 3 — per-member preferences, the firm policy floor, and the trust-compliance designation
status: building
touches: packages/notifications/, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/telemetry/src/metrics.ts, apps/worker/src/routes/notification-preferences.ts, apps/worker/src/app.ts, apps/worker/src/costs/recoverable-charge-consumer.ts, apps/worker/src/scheduled.ts, apps/worker/src/assemblies/, apps/worker/openapi/openapi.json, packages/api-client/, apps/worker/test/, changelog.d/, docs/decisions/pending/, roadmap.d/notifications.md, status.d/notifications-delivery.md, docs/deploy-queue.md, docs/active-work/
---

Slice 3 of notifications delivery, per
[`docs/specs/2026-08-06-notifications-delivery-implementation-plan.md`](../../specs/2026-08-06-notifications-delivery-implementation-plan.md).
Preferences and the firm policy floor, on the shipped settings chain. Backend only — no settings
screen.

- **The preference value** — one `notifications.preferences` key holding the per-category matrix
  (`inApp: on|off`, `email: off|daily|weekly`), resolved user over firm over the in-code default.
- **Enforcement at fan-out** — a category a member has silenced in app writes no feed row for them,
  and the suppression is recorded per member per category per civil day rather than being an
  absence. Mandatory categories (`security`, `trust`) ignore an in-app `off`; a firm may raise the
  in-app floor and may never force a member's email cadence upward.
- **The trust-compliance designation** — a firm-tier list of members who join the recipient set of
  every `trust`-category notification, written under `trust:manage` and audited by count.
- **The preference API** — `GET`/`PATCH` on the member's own key and `GET`/`PUT` on the firm's
  designation, both through the chokepoint, the `PATCH` audited with the category and the resolved
  cadence and never a recipient list.
