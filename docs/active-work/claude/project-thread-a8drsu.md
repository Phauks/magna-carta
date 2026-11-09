---
worktree: cloud session (no local worktree)
area: Attorney sub-roles (Partner, Associate) and the Owner/Admin to Admin rename
status: review
touches: packages/database (per-firm migration + schema), apps/api-worker member administration and rate capture, packages/timekeeping rate resolution, apps/web Users and Roles settings, roadmap.d/settings.md
---

Adds `role.parent_role_id` with Partner and Associate seeded under Attorney, holds the sub-role rules in
the set-roles route, prices time by sub-role then parent, and renames the Owner/Admin role to Admin.
A stream adding a per-firm migration should re-stamp after this lands.
