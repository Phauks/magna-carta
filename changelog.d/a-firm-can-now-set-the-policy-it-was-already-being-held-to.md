---
category: Added
audience: public
---

**Three notification settings were read on every pass and writable by nothing.** The preference
subsystem stores two tiers of one key, and only one of them had a route. A member could set their own
per-category matrix; the FIRM tier — the in-app floor that stops somebody silencing a category their
firm insists on — was composed into `resolveCategoryPreference` on every fan-out and could not be set
by anybody. The same held for the two firm settings beside it: `notifications.retentionDays`, read by
the nightly sweep that deletes notification rows, and `notifications.digestLocalHour`, asked of every
firm by the hourly digest pass. All three write statements existed, were correct, and had exactly one
non-test reference in the repository: their own definition. Nothing failed, because the read side
returned the default forever and the tests that covered the floor inserted the row themselves.

**`GET` and `PATCH /api/v1/firm/notifications/policy`** close it, under a new
`firm:manageNotificationPolicy` seeded to Owner/Admin only. **The permission is the decision here, not
a detail.** The member preference route rides `notifications:read`, which is deliberately seeded to
every default role including Read-only, because reading one's own feed is not a privilege. Reusing it
for the firm tier would have meant any member of any firm could raise the floor for all their
colleagues and shorten the whole firm's retention window — `apps/worker/test/firm-notification-policy-routes.test.ts`
seeds exactly that member and asserts 403 on both verbs, and swapping the route's permission back to
the member key was watched to turn both red with `expected 200 to be 403`.

**Two more properties were pinned by breaking them.** Writing the firm tier must not write the
administrator's own preferences: the test reads the `scoped_setting` rows directly and asserts a
firm-tier row with the value and zero user-tier rows for the actor, and pointing the write at
`writeMemberNotificationPreferencesStatement` instead turned four tests red. And the floor has to
actually bind, which is only observable from the other side — a member silences a category through
their own route, the firm raises the floor through this one, and the member's own read comes back
`inApp: on`, `inAppLockedBy: firm-policy`, with their own choice still on the row so lowering the floor
returns them to `off` rather than to the default.

**The window and the hour are refused outside their bounds, never clamped.** Thirty to three hundred
and sixty-five days, and an hour from 0 to 23; anything else is a 422 with nothing written. A firm that
asked for five years and silently got one would believe it had the first. Removing the bound was
watched to turn that test red.

**The sparse merge is now one function for both tiers.** `mergeNotificationPreferences` moved out of
the member route into `@magna-carta/notifications`, so "clear this channel" means the same thing
whichever tier is patching. Two copies of that is two subtly different notions of what an absent
preference is.

**A fitness function for the shape this was found by.** `pnpm run lint:unwired-writes` fails any
exported write-shaped function in `apps/` or `packages/` that nothing outside a test calls. It was
measured against the whole tree before it was kept, in both variants: the strict form reports four
today, every one a written allowlist entry with its reason (a test logger, an unused port factory over
a function production calls directly, and two control-plane tables that are seeded by hand because the
platform has no self-service grant surface for them). Replayed against the tree as it stood one commit
earlier it reports ten, including the three auto-file writers whose absence made the auto-file engine
evaluate an empty set. The looser variant — "no reference outside the defining file" — was measured at
nine against four and rejected: all five extra hits are the same correct idiom, a statement composed
into an ordered batch by a helper beside it, which is how every write whose ordering is the invariant
is written here. An allowlist entry with a blank reason, an entry naming a function that no longer
exists, and an entry whose function has since gained a caller are each failures of their own, so the
gate cannot go quiet without somebody deciding it should.

**Not built, and named rather than left implicit:** the firm's email DETAIL-LEVEL ceiling
(`notifications.emailDetailLevel`) has no write statement in either tier, so it is invisible to a scan
that looks for writers with no callers. Building only the firm half would let a firm raise what its
members' mail carries with no member lever to lower it again, which is the asymmetry the subsystem is
built to prevent; it wants both halves in one change. Recorded on the `notifications.firm-policy`
ledger node.

## Public

**Your firm can now set its own notification policy.** Three things that were fixed for everybody are
now yours to decide:

- **Which categories every member hears in app.** Turning a category on for the firm means nobody can
  switch it off for themselves — useful for the kinds of notice a practice needs its staff to see. It
  works one way only: your firm can insist a category reaches people, and cannot stop somebody hearing
  about their own work.
- **How long notifications are kept.** Anywhere from thirty days to a year. A shorter window is not a
  loss of the record — the matter timeline and the audit log keep their own — but it does decide how
  far back somebody returning from leave can scroll.
- **What time the daily and weekly summary emails go out**, in your own office's local hour rather
  than at a time the platform picked.

**Email stays the member's decision.** Your firm can set a default cadence, and can never raise
somebody's — a summary is a copy in a mailbox your firm may not administer, so the more private of the
two choices always wins.

**It is an administrator's setting, not a personal one.** Only Owner/Admin seats can read or change
it, and every change is recorded in your firm's audit log with what was changed and who changed it —
never anybody's name beyond the person who made the change.

The screens for this are still being built; what the settings mean is described in
[Notification emails](features/notification-emails.md).
