# api-worker routes/notifications — CLAUDE.md

**Purpose.** The member's notification feed and the preferences that shape it. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Notification settings — two routes, two tiers, two permissions

`src/routes/notifications/notification-preferences.ts` is the MEMBER's own matrix (and the firm's trust-compliance
designation); `src/routes/firm/firm-notification-policy.ts` is the FIRM's tier — the per-category in-app
floor, the retention window the nightly sweep reads, and the local hour the hourly digest pass asks
each firm about. They write the same two scoped-setting keys at different tiers and share one merge
(`mergeNotificationPreferences` in `@magna-carta/notifications`), so "clear this channel" has one
meaning.

**The permission split is the point, and it is not interchangeable.** The member route rides
`notifications:read`, which is seeded to EVERY default role including Read-only because reading one's
own feed is not a privilege. The firm route rides `firm:manageNotificationPolicy`, Owner/Admin only.
Putting the firm tier on the member key would let any member raise the floor for every colleague and
shorten the whole firm's retention window; `test/firm-notification-policy-routes.test.ts` seeds
exactly that member and asserts 403 on both verbs. A third notification setting that binds anybody
but the actor belongs on the firm route, not on the member one.

Two things this surface must keep doing:

- **Write the firm tier and nothing else.** An administrator changing firm policy must not be
  silently changing their own preferences. The test asserts a firm-tier `scoped_setting` row and zero
  user-tier rows for the actor.
- **Refuse an out-of-range window or hour rather than clamping.** A firm that asked for five years
  and silently got one would believe it had the first. The bound is on the request schema as well as
  on the setting definition, so the caller gets a 422 they can act on rather than a 500.

Not reachable from either route: the firm's email detail-level ceiling
(`notifications.emailDetailLevel`), which has no write statement in either tier. Building only the
firm half would let a firm raise what its members' mail carries with no member lever to lower it,
which is the asymmetry `@magna-carta/notifications` exists to prevent — it wants both halves at once.
