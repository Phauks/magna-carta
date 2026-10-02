---
number: 388
slug: a-firm-policy-floor-is-a-firm-administration-act-not-a-personal-preference
status: Proposed
date: 2026-08-19
area: Notifications / Authorization
summary: "The firm tier of the notification settings — the per-category in-app floor, the retention window and the digest local hour — gets its own surface, GET/PATCH /api/v1/firm/notifications/policy, behind a new firm:manageNotificationPolicy seeded to Owner/Admin only. All three settings shipped with write statements and no production caller: the floor was composed into every fan-out and could not be raised, the window was read by the nightly sweep and could not be changed, and the hour was asked of every firm hourly and was 07:00 everywhere. The permission is the substance of the decision. The member preference route rides notifications:read, which is deliberately seeded to EVERY default role including Read-only because reading one's own feed is not a privilege; reusing it for the firm tier would let any member raise the floor and shorten retention for every colleague. The retention window and digest hour are refused outside their declared bounds rather than clamped. The firm's email detail-level ceiling is deliberately NOT included: it has no write statement in either tier, and shipping the firm half alone would create the one asymmetry this subsystem exists to prevent."
---

**A setting that binds people other than the person changing it is a different act from a setting that
binds only them, and the two cannot share a permission.**

**Context:** The notifications subsystem stores two tiers of one scoped-setting key. `PATCH
/api/v1/notifications/preferences` writes the member's tier, gated on `notifications:read` with a
written justification: a member configuring their own feed is the same self-scoped act as reading it,
and gating somebody's own switches behind an administrative key would mean a firm whose staff cannot
turn off their own email. That reasoning is right, and it is exactly why the key cannot be reused one
tier up — `notifications:read` is seeded to every default role including Read-only.

The firm tier had no route at all. `writeFirmNotificationPreferencesStatement`,
`writeNotificationRetentionDaysStatement` and `writeNotificationDigestLocalHourStatement` each had one
non-test reference in the repository: their own definition. Every one of the three is read at
evaluation time — the floor by `resolveCategoryPreference` inside the one shared recipient resolver on
every fan-out, the window by the nightly retention sweep, the hour by the hourly digest pass — so all
three read a default forever and nothing failed. The tests that covered the floor inserted the row
themselves, which is the shape that makes this class of defect invisible to a suite.

**Decision:** A separate route bundle, `apps/worker/src/routes/firm-notification-policy.ts`, behind a
new registry permission `firm:manageNotificationPolicy`, seeded to Owner/Admin only by
`20260819T140000_seed-notification-policy-permission.sql`, mirroring `firm:manageScanPolicy`'s own
admin-only seed.

Three properties fall out of the split and each is pinned by a test that was watched to fail with the
property removed:

- **A member holding `notifications:read` and nothing else gets 403 on both verbs.** Pointing the
  route at the member key turns both red with `expected 200 to be 403`.
- **The write lands on the firm tier and nowhere else.** An administrator setting firm policy must not
  be silently setting their own preferences, so the test reads `scoped_setting` directly and asserts a
  firm-tier row carrying the value and zero user-tier rows for the actor. Pointing the write at the
  member statement turns four tests red.
- **The floor binds, observed from the other side.** A member silences a category through their own
  route; the firm raises the floor through this one; the member's own read returns `inApp: on`,
  `inAppLockedBy: "firm-policy"`, with their own stored choice intact so lowering the floor returns
  them to it rather than to the platform default.

**The window and the hour are refused outside their bounds, never clamped.** Thirty to 365 days, and
an hour in `[0, 23]`; anything else is a 422 with nothing written. A firm that asked for five years and
silently received one would believe it had the first, and a retention setting is exactly the kind a
firm records in a policy document and does not re-read.

**Considered and rejected.** **Extending the member PATCH with a firm block** — one route, two
permissions, and a body whose meaning depends on which half is present. The chokepoint carries one
permission per operation by design, and splitting a route's authorization by field is the shape that
produces a route nobody can reason about. **Reusing `trust:manage`,** which already gates the
trust-compliance designation on the preferences route — that designation is a trust-accounting control
that happens to name recipients; the in-app floor is not, and a firm's bookkeeper is not thereby its
notifications administrator. **A generic `firm:manageSettings`** — there is no such key and inventing
one would collapse scan policy, release channel, secrets and notifications into a single grant, which
is the opposite direction from every other settings capability in the registry.

**Deliberately not included: the firm's email DETAIL-LEVEL ceiling** (`notifications.emailDetailLevel`).
It has no write statement in either tier, so the mechanical scan that found the other three could not
see it. Building only the firm half would let a firm raise what its members' mail carries with no
member lever to lower it again — the exact asymmetry the subsystem's design refuses, since by email the
member's choice is meant to win. It wants both halves in one change, and is recorded on the
`notifications.firm-policy` ledger node rather than half-built here. The user documentation, which
claimed a firm could set that ceiling, is corrected in the same change.

**Consequences:** A firm can raise the in-app floor, set its retention window and move its summary
hour. `mergeNotificationPreferences` moves into `@magna-carta/notifications` and is shared by both
tiers, so "clear this channel" has one meaning. The three writers gain production callers, which is
what the accompanying unwired-write fitness function now holds them to.
