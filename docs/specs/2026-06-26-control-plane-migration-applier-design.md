# Control-plane migration applier — design

**Date:** 2026-06-26
**Status:** Design (approved in brainstorming; not yet planned or built).
**Scope (single home for):** how control-plane D1 migrations are applied in production — automatically, without a manual deploy step — and how request code tolerates the brief post-deploy window.
**Authoritative context:** the migration runner (`packages/database/src/migration-runner.ts`, `d1-migration-target.ts`); the per-firm runtime-bundled model (`apps/worker/src/per-firm-migrations.ts`, `firm-provisioner-wiring.ts`); the scheduled handler (`apps/worker/src/scheduled.ts`).

## Why

The per-firm D1 lineage is migrated at runtime: migrations are bundled into the worker (`perFirmMigrations()`) and applied at a firm's **provision** lifecycle event, before that firm is ever served. The **control-plane** lineage has no production applier at all — only a test helper (`apps/worker/test/support/apply-control-plane-migrations.ts`). The release-channels work added control-plane migration `0003` (the `firm.release_channel` column), which `/me` reads on every session bootstrap, surfacing the gap: deploy the worker against a control-plane D1 that lacks `0003` and `/me` would 500 fleet-wide.

The goal: apply control-plane migrations **automatically** (no manual runbook step), **safely**, and tolerate the brief window between a deploy and the migration landing.

## Verified constraint — the applier must be single-flighted

The runner is reusable across lineages (`runPendingMigrations(d1MigrationTarget(db), migrations)` works against any D1), but it is **not safe to run concurrently against the same database for the same pending migration**. Verified in the code:

- `_migrations` is `tag TEXT PRIMARY KEY`; each migration applies as **one atomic `batch()`** = `[<migration statements>, INSERT INTO _migrations(tag, …)]` (`d1-migration-target.ts`).
- `runPendingMigrations` reads applied tags, applies each pending migration, and **fails loud on the first error** (`migration-runner.ts`, no error handling).

So if N worker isolates cold-start after a deploy and all see the same migration pending, they race: exactly one batch commits; every other isolate's batch fails (`duplicate column name` or `UNIQUE constraint failed: _migrations.tag`) and `runPendingMigrations` **throws**. A cold-start "migrate-before-serve" gate would therefore emit a burst of N−1 errors per migration-bearing deploy unless it carried a single-flight coordinator (a Durable Object) or an optimistic apply-then-recheck wrapper — machinery not worth its cost here.

The **scheduled (Cron) handler is single-flighted by construction**: Cloudflare fires the trigger as one invocation per tick. Making the cron the **sole** runtime applier means zero concurrency — the clean home.

## Design

### 1. Bundle the control-plane lineage into the worker

New `apps/worker/src/control-plane-migrations.ts`, the exact mirror of `per-firm-migrations.ts`:

- `controlPlaneMigrations(): Migration[]` — `migrationsFromJournal(controlPlaneJournal, { …all control-plane SQL imports… })`. `migrationsFromJournal` fails loud if the journal gains a tag the map does not carry, so the map is self-checking.
- `controlPlaneHeadSchemaVersion(): string` — the journal's last tag.

Refactor `apps/worker/test/support/apply-control-plane-migrations.ts` to call `controlPlaneMigrations()` so test and production share one migration map and can never drift.

### 2. Cron sweep — the sole runtime applier

In `apps/worker/src/scheduled.ts`, add a control-plane migration sweep that runs **first** in the handler (before the existing control-plane outbox sweep, so the schema is current before other control-plane work in the same tick):

```
await runPendingMigrations(d1MigrationTarget(env.DB_CONTROL), controlPlaneMigrations());
```

Wrapped in the handler's existing error-isolation pattern (try/catch + telemetry, like the outbox sweep) so a migration failure is observable and does not starve the rest of the scheduled run. Idempotent: a no-op read once at head. Runs on the frequent (`*/5`) trigger, so a fresh deploy converges within one cron cycle. The cron is the **only** runtime caller of the control-plane applier — no other path applies it, so there is no concurrency.

### 3. Fail-safe read discipline — tolerate the window

A control-plane read of a **not-yet-applied additive column** must degrade to a safe default, never 500. This closes the deploy window harmlessly:

- **Convention:** control-plane migrations stay additive (already enforced by the expand-contract test); request code that reads a new control-plane column tolerates its brief absence by defaulting.
- **`/me` hardening:** the `channel` + `flags` enrichments are best-effort. A failure to read the channel (e.g. the column is briefly absent right after a deploy, or any read error) yields `channel: "stable"` and the default flag set, logged — never a failed bootstrap. This is the same fail-safe-to-stable philosophy the feature already uses for an absent `FLAGS` binding, and it is a legitimate robustness property for a bootstrap endpoint independent of migrations.

### 4. Docs

- `docs/conventions/operations.md`: a control-plane-migrations section — application is automatic via the scheduled handler (no manual step); the single-flight rationale; the additive + fail-safe-read discipline; and **deploy-time application documented as the future zero-window hardening** (run the migrations in the Workers Builds command before `wrangler deploy`, single-flight by construction — adopt when production firms make a zero-width window matter).
- ADR fragment: control-plane migrations apply at runtime via the single-flighted scheduled handler, mirroring the per-firm runtime-bundled model; reads of new additive columns fail-safe; deploy-time is the future hardening.
- changelog fragment.
- Update `docs/active-work/release-channels.md`: the deploy precondition is now automated (the scheduled handler applies `0003` within one cron cycle; `/me` fail-safes meanwhile).

## Testing

- **Bundle:** `controlPlaneMigrations()` returns all journal entries (the map covers the journal); `controlPlaneHeadSchemaVersion()` equals the last tag.
- **Cron sweep (integration):** extend `apps/worker/test/scheduled.test.ts` — against a control-plane D1 migrated to an earlier tag (or fresh), invoke the scheduled handler and assert `DB_CONTROL` reaches head (`_migrations` contains the head tag / `release_channel` exists). Re-invoke and assert it is a no-op (idempotent).
- **/me fail-safe (unit):** the channel-read helper returns `"stable"` (and default flags) when the underlying read throws, rather than propagating — proving the bootstrap cannot 500 on a transient channel-read failure.
- **Test applier refactor:** existing control-plane-backed worker tests still pass against the bundle-delegating `apply-control-plane-migrations.ts`.

## Alternatives considered

- **Cold-start migrate-before-serve gate (runtime).** Rejected: concurrent isolates racing the same pending migration throw (verified — atomic batch + PK conflict + fail-loud runner), so it needs a Durable Object coordinator or an optimistic-recheck wrapper. The concurrency cost outweighs the benefit when the cron + fail-safe discipline already cover it.
- **Deploy-time application (Workers Builds step).** The strongest correctness (single-flight by construction; true migrate-before-serve; the deploy is the control plane's lifecycle event, mirroring per-firm-at-provision). Deferred, not rejected: it needs a Workers Builds command step, a D1-over-HTTP `MigrationTarget` adapter, and an API token as a build secret. Documented as the future hardening for when production firms make the window matter.
- **Secret-guarded operator endpoint.** Rejected as the primary mechanism: explicit and auditable but still a manual step — the thing automation removes. The existing `firms.provision` pattern remains available if a deliberate manual apply is ever wanted.

## Out of scope

- Deploy-time application (future hardening, documented only).
- Any change to the per-firm applier (it already migrates at provision time).
- A migration coordinator Durable Object (only needed if a cold-start gate were adopted).
