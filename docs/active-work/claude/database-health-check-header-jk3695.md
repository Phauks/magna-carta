---
worktree: /home/user/magna-carta (remote session)
area: Firm database health in the header's Build Versions panel — a new GET /api/v1/meta/database-health read, and the panel's Deployment and Database sections behind carets
status: building
touches: apps/api-worker/src/routes/meta-database-health.ts, apps/api-worker/src/app.ts, apps/api-worker/openapi/openapi.json, apps/web/src/lib/versions, apps/web/test, docs/user/features/seeing-what-version-you-are-on.md, changelog.d/
---

The header chip answered "what is running" and nothing about whether this browser's session can
actually reach its firm's data. A newly created firm surfaced that gap: every permission-gated
screen answered 403 ("Your role does not grant this action in this firm") with nothing on screen
saying why, because the owner's member row had not yet been mirrored into the firm's per-firm
database. This stream adds the read that names that state — control plane, firm database round
trip, schema lineage, this account's membership and roles, and any provisioning message still
pending or dead-lettered — and folds it into the same panel as a second section, with Deployment
and Database both behind remembered carets.

Confined to `apps/web/src/lib/versions/` and one new API route module; the only shared file touched
is `apps/api-worker/src/app.ts` (one registration line) and the regenerated `openapi.json`.
