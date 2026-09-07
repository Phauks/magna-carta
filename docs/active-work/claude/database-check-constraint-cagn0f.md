---
worktree: C:/dev/magna-carta-worktrees/claude/database-check-constraint-cagn0f
area: The matter status rename's copy step, and the diagnostic reads that went dark behind it
status: building
touches: packages/database/drizzle/per-firm, packages/database/src/reviewed-rebuilds.ts, packages/database/test, apps/api-worker/src/chokepoint, apps/api-worker/src/routes/meta-versions.ts, apps/api-worker/src/routes/meta-database-health.ts
---

A deployed firm held a matter still spelled `prospective`, which the matter status rename's copy
step could not carry into a table whose CHECK admits only the new vocabulary. The migration failed,
and because the per-firm lineage is applied in the FirmDatabase durable object's constructor, the
firm's entire database went with it. The copy now maps that one value; the correction is inside the
migration itself, which is the only place it can be — the runner stops at the first failure, so no
later migration is ever reached to repair it.

The second half of the stream is why the fault was slow to find: the version and database-health
reads are the surfaces meant to report exactly this, and both are firm-scoped, so both died with the
database they exist to describe. Anything touching the chokepoint's firm resolution is this stream's.
