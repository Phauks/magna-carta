---
worktree: C:/dev/magna-carta-worktrees/claude/friendly-shannon-oskld0
area: The firm-administrator AI settings screen — the two consent gates a firm opens before anything reaches a model, and the assistant's daily ceiling
status: building
touches: packages/access-control, packages/database/drizzle/per-firm, apps/api-worker/src/routes, apps/web/src/lib/settings, apps/web/src/lib/ai, apps/web/src/routes/(app)/settings/ai, packages/magnus/CLAUDE.md, roadmap.d/ai.md, status.d/magnus.md
---

Builds the screen `packages/magnus/CLAUDE.md` names as missing: until now `inference.aiProcessingEligibility`
and `magnus.enabled` were reachable only through the settings write path, so every firm's assistant
rendered its closed state and no administrator could open it. Adds one permission
(`firm:manageAiSettings`), one audited route pair (`GET`/`PATCH /api/v1/firm/ai/settings`), and one
settings section under Firm Settings · Data & Platform. Touches the shared settings registry to add a
`number` setting kind — nothing else on that registry changes shape.
