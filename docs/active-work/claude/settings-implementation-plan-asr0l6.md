---
worktree: C:/dev/magna-carta-worktrees/claude/settings-implementation-plan-asr0l6
area: Settings surface completion — the plan for every stubbed section, then the slices it orders: members and rights, a member's own name, file safety, notifications, beta access, firm profile
status: building
touches: docs/specs/, apps/api-worker/src/http/routes/, apps/web/src/routes/(app)/settings/, apps/web/src/routes/account/, apps/web/src/lib/settings/, packages/access-control/src/registry.ts, packages/data-access/src/member-statements.ts, packages/directory/src/, packages/database/drizzle/, roadmap.d/settings.md, status.d/
---

Inventories what every settings section actually is today against what the server can already
answer, fixes the order the gaps close in, and builds down that order: the firm administering its
members (role assignment, deactivation, and the real permission check behind every firm page's
posture), a member's own name as parts, File Safety & Scanning over the firm scan policy,
Notifications at both tiers, Beta Access, and Firm Profile. Anything under
`apps/web/src/routes/(app)/settings/`, the members or firm-policy routes, or
`apps/web/src/lib/settings/` collides with this stream.
