# Per-firm database on a SQLite-backed Durable Object — design

**Date:** 2026-06-23 · **Status:** Designed (spike-validated), pre-plan · **Supersedes:** the per-firm-D1 half of ADR-0003 (tenancy & data isolation) · **White paper:** _Tenancy & data isolation_, _Performance & concurrency model_.

This spec replaces the per-firm **D1 database** with a per-firm **SQLite-backed Durable Object**, addressed by `firmId`. The control-plane D1 and all R2 are unchanged. It is the resolution of the seam slice 0·4 deliberately deferred ("dynamic dispatch / Workers for Platforms — revisit when firm #2+ makes it real").

## Problem

Per-firm D1 is reached through a **static Worker binding** (`DB_FIRM_POOL_1/2`), resolved by `apps/worker/src/firm-binding-resolver.ts`. A firm beyond the pre-declared pool needs a config commit + redeploy to bind its database. This does not scale:

- A single Worker can hold at most **~5,000 bindings** — a hard ceiling on firms-per-Worker for the static-binding shape, independent of the operational friction of a redeploy per firm.
- The bindings list congests operationally as firms grow (the question that opened this work).

The goal: **an effectively unbounded number of firms with no per-firm redeploy.**

## Decision

The per-firm database becomes **one Durable Object class, `FirmDatabase`, addressed `idFromName(firmId)`** — implicitly created on first access, no per-firm binding, no redeploy, scaling to millions of instances. Per-firm relational data lives in that DO's embedded SQLite (10 GB/instance). Bulk content stays in R2 (golden rule 3, unchanged).

### Alternatives rejected

- **Bindingless D1 over the HTTP API.** Dead, not even an interim. There is no runtime dynamic-D1-binding mechanism (confirmed by a Cloudflare `workerd` maintainer), and the only bindingless transport — the D1 REST API — shares the global Cloudflare API limit of **~1,200 req / 5 min (~4 req/s)**, categorically unusable for request-time serving.
- **Workers for Platforms (dynamic dispatch).** Works and is cheap ($25/mo self-serve + ~$0.02/firm, not Enterprise-gated), and preserves a native per-firm D1 binding inside each user Worker with no dispatcher redeploy. But it is built to run **different per-tenant code**; every firm here runs **identical** logic, so a per-firm user Worker is either a thin shim (pure overhead over holding the binding ourselves) or our whole app packaged and re-uploaded to N scripts per release (a real CI tax). Earmarked as the destination **only if tenant-supplied code/extensions** ever materialize — this design forecloses nothing there (see _WfP seam_).
- **Per-firm DO-SQLite (chosen).** Binding-free unlimited addressing; **better** transactional guarantees for the trust/financial ledger than D1 (interactive `transactionSync` vs D1's transaction-less `batch()`); no new product tier; and the codebase is already abstracted for it.

### Why the codebase is ready (evidence)

The domain layer (~185 query sites across 6 packages) is already written against an abstract `SqlDatabase`/`SqlStatement`/`BatchDatabase` interface, not `D1Database`. Concrete `D1Database` lives only in the migration seam and the worker edge. A throwaway spike (`spike/per-firm-do-sqlite` branch) proved the data plane is mechanical — three green tests exercising the **real** per-firm migration lineage and a **real, unmodified** statement module against `ctx.storage.sql`:

| Validated | Result |
|---|---|
| Self-migrate-on-wake | all 18 per-firm migrations (`0000…0017`) applied in the DO constructor via `doSqliteMigrationTarget` + `blockConcurrencyWhile` |
| `meta.changes` fidelity (guarded `UPDATE`/`DELETE` depend on it) | faithful 1 / 0 / 1, via a `SELECT changes()` mapping — **not** the cursor's `rowsWritten`, which counts index rows |
| UNIQUE-conflict detection + atomicity | `isIdempotencyKeyConflict` matched DO SQLite's message text unchanged; `transactionSync` rolled the whole batch back (0 rows persisted) |

## Architecture

### The two adapters (spike-proven; ~100 LOC)

- **`doSqliteBatchDatabase(storage)`** — implements the existing `SqlDatabase`/`BatchDatabase` contract over `ctx.storage.sql`. `run()` maps `meta.changes` from a `SELECT changes()` probe; `batch()` runs all statements inside `ctx.storage.transactionSync` for all-or-nothing atomicity (the documented DO primitive — not explicit `BEGIN/COMMIT`). Lands beside `packages/database/src/node-sqlite.ts` and `d1-migration-target.ts` as "adapt a database to the shared shape."
- **`doSqliteMigrationTarget(storage)`** — a `MigrationTarget` over `ctx.storage.sql`; slots into the target-agnostic `runPendingMigrations` with no runner change. (DO SQLite does not support `PRAGMA user_version`; version tracking stays in the runner's `_migrations` table, as it already does.)

### The `FirmDatabase` Durable Object

- **Self-migrate-on-wake:** the constructor runs `blockConcurrencyWhile(() => runPendingMigrations(doSqliteMigrationTarget(ctx.storage), perFirmMigrations()))` — the same lineage the provisioner uses today. A cold firm migrates on its first access after a deploy; untouched firms migrate lazily when next accessed. This retires `fleet-rollout.ts`'s central iteration.
- **Data-plane RPC surface (the key wiring):** route handlers run in the app Worker, but SQLite lives in the DO. So the worker-side `SqlDatabase` becomes a **proxy** that marshals each `run()`/`all()`/`batch()` to the DO over RPC (statements are SQL text + bound params — fully serializable), where `doSqliteBatchDatabase` executes them. **The statement modules and services stay unchanged** — they compose `SqlStatement`s against the proxy exactly as against D1 today. An idempotent effect commits as **one** `commitBatch` RPC (the batch is the transactional unit → one hop), and the conflict outcome is returned as a **typed result**, not a thrown error across the RPC boundary, so conflict detection does not depend on error-message identity surviving serialization.

### Migration / coexistence — clean cut (no real users yet)

There is no production firm data to preserve, so there is **no dual-run feature flag**. The per-firm D1 pool, `firm-binding-resolver.ts`, and the per-firm `createDatabase` provisioning path are **retired outright**; the single demo firm is re-provisioned onto a `FirmDatabase` DO. Tests rewire wholesale to `runInDurableObject`. (Had there been live firms, the abstract interface would have allowed DO-for-new / D1-for-existing in parallel — noted for completeness, not needed here.)

### The cron relay re-homing — the one real fork

Today `apps/worker/src/scheduled.ts` enumerates every active firm from one Worker and sweeps each firm's outbox + idempotency-purge + stale-uploads in a loop. A DO removes that central handle. Two options:

- **(A) Per-DO alarm self-sweep — recommended.** Each `FirmDatabase` arms a recurring alarm to sweep its own outbox / purge its own idempotency records / sweep its own stale uploads. This is the idiomatic DO pattern and preserves both guarantees that matter: at-least-once delivery, and **per-firm failure isolation** (a wedged firm's alarm cannot starve the fleet — structurally, not by convention).
- **(B) Central cron via per-firm RPC.** Keep the cron loop, call a sweep RPC per firm. Preserves today's shape but re-introduces O(firms) fan-out per tick and a round-trip per firm.

Recommend **(A)**. The control-plane outbox sweep stays in cron (control-plane is still D1). Storage reconciliation (a full R2 LIST per firm) stays in cron — it is R2 work, not per-firm-DB work. **This re-homing carries the highest correctness risk in the whole port and gets the hardest tests.**

## Risks & mitigations

1. **10 GB per firm is a hard ceiling, no overflow.** Ample for core practice-management metadata (matters, time, ledger, custom fields, document *metadata*). The risk is **discovery/custodian** metadata (millions of doc rows) and append-only **audit logs**. These are a **separate, deferred decision** for when those subsystems are built (candidates: per-matter DO shard, keep that high-volume metadata in D1, or a search index). This design leaves the seam and does not pre-decide it.
2. **Single-writer per firm (~1,000 req/s soft).** Fine for interactive human data entry; it also gives the ledger stronger local transactions. Bulk writes (discovery ingestion, month-end billing/trust runs, per-document scan/OCR callbacks) must be pushed off the interactive path onto Queues so they don't serialize behind — or ahead of — a firm's users.
3. **No read replicas + sticky homing.** A DO homes near first access and does not relocate. Set `locationHint` from the firm's declared region at creation, and control first-access so a stray request (CI, an admin elsewhere) cannot mis-home a firm.
4. **Residual unknowns to verify in the implementation spike:** the read-hop count per request through the RPC proxy (batch writes are one hop; multi-query reads are several — measure and, if needed, add a DO-side composite read), and confirming the typed-result conflict path needs no error-identity-across-RPC.

## Blast radius (from codebase analysis)

**Must change:** the two adapters (`packages/database`, `packages/data-access`, mechanical); the `FirmDatabase` DO + RPC proxy (`apps/worker`, moderate); request wiring in `chokepoint/ports.ts` + the 3 consumers (`ingest`, `member-provision`, `inference`, mechanical-but-request-path); the relay re-homing in `scheduled.ts` (moderate–invasive, one design fork); ~30 test files to `runInDurableObject` (volume, ~16–26h).

**Stays identical:** control-plane D1 and its sweeps; all ~185 domain statement modules + services; `commitEffectBatch`/outbox/idempotency core; **all R2** (`createBucket`, `configureBucketNotifications`, presigner, ingest, reconciliation listing); the per-firm drizzle schema + generated migration SQL; `migration-runner.ts`.

**Becomes obsolete:** `firm-binding-resolver.ts` + the `DB_FIRM_POOL_*` bindings + the config-commit-and-deploy-to-bind step; `fleet-rollout.ts` central iteration; the REST adapter's per-firm `createDatabase`/`findDatabaseByName`; the dev pool-claimer; `firm.database_identifier` as a binding pointer (the DO name **is** `firmId`).

## Build sequence

1. **Adapters** into `packages/database` + `packages/data-access` — spike-proven; unit-test `meta.changes`/cursor/atomicity in `@cloudflare/vitest-pool-workers`.
2. **`FirmDatabase` DO** — `ctx.storage.sql`, self-migrate-on-wake using `perFirmMigrations()`, and the data-plane RPC (`runRead`, `commitBatch` returning a typed outcome).
3. **Request wiring** — swap `resolveFirmDatabase` → the DO proxy in `chokepoint/ports.ts` and the 3 consumers.
4. **Relay re-homing** — make the (A) alarm decision real; move `scheduled.ts`'s per-firm half into per-DO alarms; retire `fleet-rollout`.
5. **Provisioner** — delete per-firm `createDatabase`/migrate-step + the pool/binding-resolver; keep the entire R2 path.
6. **Tests** — rewire the ~30 per-firm files.

Steps 1–3 are low-risk and isolatable; the commitment risk lives almost entirely in step 4.

## WfP seam

If tenant-supplied code/extensions ("maybe someday") are ever scheduled, Workers for Platforms is the earmarked home (per-tenant user Workers, outbound Workers for egress control). Nothing in this design blocks it: per-firm data would simply be reached from the tenant's user Worker the same way — by `firmId`-addressed DO stub. No seam is built now; this paragraph is the pointer.
