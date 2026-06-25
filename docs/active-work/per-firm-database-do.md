---
branch: per-firm-database-do
worktree: C:/dev/magna-carta-worktrees/per-firm-database-do
area: Tenancy — per-firm database on a SQLite-backed Durable Object
status: built — full worker + db suites green, vp check clean; pre-merge review pending
touches: docs/specs/2026-06-23-per-firm-database-durable-object-design.md (new), docs/decisions/pending/per-firm-database-durable-object.md (new ADR fragment, supersedes per-firm-D1 half of ADR-0003), packages/database/** (doSqliteMigrationTarget + DO-SQLite batch adapter), packages/data-access/** (proxy SqlDatabase), apps/worker/src/spike/** (throwaway, on spike branch only), apps/worker/src/firm-binding-resolver.ts (retire), apps/worker/src/firm-resource-provider.ts (retire per-firm createDatabase), apps/worker/src/scheduled.ts (relay re-homing — HIGH-RISK), apps/worker/wrangler.jsonc (DO binding + migration), apps/worker/src/index.ts (DO export), ~30 apps/worker/test/** files, STATUS.md, ROADMAP.md
---

Replace the per-firm **D1 database** (reached by static `DB_FIRM_POOL_*` bindings → config-commit + redeploy per firm, capped at ~5k bindings/Worker) with a per-firm **SQLite-backed Durable Object** addressed by `firmId` — binding-free, no redeploy, scales to millions. Control-plane D1 and all R2 unchanged. Resolves the seam slice 0·4 deferred.

Approaches investigated (deep multi-agent research, cited): bindingless D1-over-HTTP (DEAD — ~4 req/s API cap, no runtime dynamic binding); Workers for Platforms ($25/mo self-serve, works, but solves tenant-code isolation we don't need — earmarked for a future tenant-code capability); **per-firm DO-SQLite (CHOSEN)** — better ledger transactions, codebase already abstracted behind `SqlDatabase`, no new tier.

Spike-validated on branch `spike/per-firm-do-sqlite` (disposable): 18-migration self-migrate-on-wake, faithful `meta.changes` via `SELECT changes()`, UNIQUE-conflict detection + `transactionSync` batch rollback, real unmodified statement module through the existing contract.

Clean cut (no live users): retire the per-firm D1 pool outright, re-provision the demo firm onto a DO; no dual-run flag.

**All phases complete.** The `FirmDatabase` Durable Object is built, the `firmDatabaseProxy` worker-side proxy wires all ~185 data-access statement modules unchanged, the chokepoint + three queue consumers (ingest, member-provision, inference) + the cron sweep all resolve a firm's database by `firmId` through the DO. Relay re-homed as a central cron sweep (option B chosen); the per-DO alarm self-sweep is a documented scale-seam. `DB_FIRM_POOL_*` bindings, `firm-binding-resolver.ts`, and the per-firm `createDatabase` + migrate-at-provision step are retired.

Deferred seams: (a) vestigial `firm.database_identifier` + `per_firm_schema_version` columns + `database_identifier` UNIQUE index (expand-contract drop, later control-plane migration); (b) per-DO alarm relay scale-seam; (c) 10 GB-per-firm hard cap — high-volume discovery/custodian + append-only audit-log metadata needs a separate future decision; (d) read-hop-count check under read-heavy routes.

Design: `docs/specs/2026-06-23-per-firm-database-durable-object-design.md`. Plan: `docs/specs/2026-06-23-per-firm-database-durable-object-implementation-plan.md` (10 tasks, 6 phases). ADR fragment: `docs/decisions/pending/per-firm-database-durable-object.md`.
