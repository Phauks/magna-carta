---
worktree: C:/dev/magna-carta-worktrees/claude/settings-implementation-plan-asr0l6
area: Settings surface completion — the plan for every stubbed section, then the firm members and rights slice
status: building
touches: docs/specs/, apps/api-worker/src/routes/members.ts, apps/web/src/routes/(app)/settings/users/, apps/web/src/lib/settings/, packages/data-access/src/member-statements.ts, roadmap.d/settings.md, status.d/
---

Inventories what every settings section actually is today against what the server can already
answer, fixes the order the gaps close in, and builds the first slice: the firm administering its
members — role assignment, deactivation, and the real permission check behind every firm page's
posture. Anything touching `/settings/users`, the members routes, or
`apps/web/src/lib/settings/settings-permissions.ts` collides with this stream.
