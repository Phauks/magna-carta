---
worktree: C:/dev/magna-carta-worktrees/claude/database-check-constraint-cagn0f
area: The matter status rename's copy step, and the diagnostic reads that went dark behind it
status: building
touches: packages/database/drizzle/per-firm, packages/database/src/reviewed-rebuilds.ts, packages/database/test, apps/api-worker/src/chokepoint, apps/api-worker/src/routes/meta-versions.ts, apps/api-worker/src/routes/meta-database-health.ts, apps/api-worker/openapi/openapi.json, packages/api-client, apps/web/src/lib/versions, apps/web/src/routes/(app)/matters, apps/web/test, packages/database/scripts/collapse-baseline.mjs, packages/database/src/legacy-baselines.ts, packages/database/src/migration-runner.ts, apps/api-worker/src/per-firm-migrations.ts, apps/api-worker/test/support/non-mutating-post-allow-list.ts, apps/api-worker/test/conformance.test.ts, apps/api-worker/test/auth-provisioning-e2e.test.ts
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

Second round, after that shipped and the firm database was STILL not answering: the panel named the
symptom and not the cause, because the health read caught the durable object's error in a bare
`catch` and dropped it. It carries that message now, scrubbed and bounded. The docket's failure
branch interpolated a failure RECORD and rendered `[object Object]`; it goes through the standard
failure surface. The panel itself is this stream's too — copy takes the whole diagnosis from a
control at the top, and Workers is a caret beside Deployment rather than a drawer inside it — which
means `version-chip.svelte`, its two test files, and the panel's fold preferences are all owned here.

Third round, and the one that ends the stream: the per-firm lineage collapses from 105 migrations
into one dumped baseline, which is what retires the five table rebuilds that cannot run against a
populated database rather than grandfathering them forever. The whole `drizzle/per-firm` tree is
this stream's, along with the migration runner's reconciliation loop and the collapse script.

Two failures found on main while verifying that, and repaired here because nothing else was going
to: the durable-object pragma probes were committed with assertions written to REVEAL the runtime's
answer rather than to state it, so the file did not parse; and the non-mutating-POST exemption list
existed twice, drifted, and left `uploads.matches` failing one of the two conformance sweeps. That
list now has one home in `test/support/`.
