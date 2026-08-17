---
branch: claude/honest-signals
worktree: /home/user/magna-carta/.claude/worktrees/honest-signals
area: calendar zone-discovery read reports its own clamp; feature-ledger in-build sweep
status: building
touches: packages/calendar, packages/notifications, roadmap.d, docs/now.md, docs/now.html, apps/worker/src/routes/calendar.ts
---

# claude/honest-signals

Two independent honesty defects, both about a signal that reads healthy while saying nothing.

**One — `readOpenDeadlineTimeZones` could not report its own truncation.** It took a `limit` and
returned `Promise<string[]>`, so no caller could tell a complete zone list from a cut-short one
without over-reading and comparing. The notifications comparison sweep had hand-rolled exactly that
at its call site. The read now over-reads by one itself and returns `{ timeZones, clamped }`, the
shape the notification digest's window read already uses; the sweep consumes the signal instead of
deriving it and its `notifications.comparison_zone_discovery_truncated` counter still counts
truncated passes, unchanged.

**Two — the `in-build` sweep.** Every node at `in-build` across `roadmap.d/` checked against the
repository rather than against its own status fragment, because a docs-only branch produces a
plausible fragment and `lint:ledger-staleness` compares only against that. Statuses corrected only
where the evidence is unambiguous; nodes genuinely between `partial` and `in-build` are left alone
and named in the pull request.

**Do not step on:** `roadmap.d/`, `docs/now.md`, `docs/now.html` (rendered — a second stream flipping
a node collides here), `packages/calendar/src/deadline-statements.ts`,
`packages/notifications/src/sweep.ts`. `tooling/` is another stream's; nothing here touches it.
