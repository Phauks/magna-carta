---
branch: per-firm-database-do
worktree: C:/dev/magna-carta-worktrees/per-firm-database-do
area: Tenancy — per-firm database on a SQLite-backed Durable Object
status: building — Phases 1–2 done + green + rebased onto main; Phase 3–6 remaining (request wiring, relay re-homing, retire pool, test rewire). Task order corrected: 9 (test rewire) before 8 (remove pool).
touches: docs/specs/2026-06-23-per-firm-database-durable-object-design.md (new), docs/decisions/pending/per-firm-database-durable-object.md (new ADR fragment, supersedes per-firm-D1 half of ADR-0003), packages/database/** (doSqliteMigrationTarget + DO-SQLite batch adapter), packages/data-access/** (proxy SqlDatabase), apps/worker/src/spike/** (throwaway, on spike branch only), apps/worker/src/firm-binding-resolver.ts (retire), apps/worker/src/firm-resource-provider.ts (retire per-firm createDatabase), apps/worker/src/scheduled.ts (relay re-homing — HIGH-RISK), apps/worker/wrangler.jsonc (DO binding + migration), apps/worker/src/index.ts (DO export), ~30 apps/worker/test/** files, STATUS.md, ROADMAP.md
---

Replace the per-firm **D1 database** (reached by static `DB_FIRM_POOL_*` bindings → config-commit + redeploy per firm, capped at ~5k bindings/Worker) with a per-firm **SQLite-backed Durable Object** addressed by `firmId` — binding-free, no redeploy, scales to millions. Control-plane D1 and all R2 unchanged. Resolves the seam slice 0·4 deferred.

Approaches investigated (deep multi-agent research, cited): bindingless D1-over-HTTP (DEAD — ~4 req/s API cap, no runtime dynamic binding); Workers for Platforms ($25/mo self-serve, works, but solves tenant-code isolation we don't need — earmarked for a future tenant-code capability); **per-firm DO-SQLite (CHOSEN)** — better ledger transactions, codebase already abstracted behind `SqlDatabase`, no new tier.

Spike-validated on branch `spike/per-firm-do-sqlite` (disposable): 18-migration self-migrate-on-wake, faithful `meta.changes` via `SELECT changes()`, UNIQUE-conflict detection + `transactionSync` batch rollback, real unmodified statement module through the existing contract.

Clean cut (no live users): retire the per-firm D1 pool outright, re-provision the demo firm onto a DO; no dual-run flag.

The one real fork / highest risk: the cron relay re-homing (`scheduled.ts`) — per-DO alarm self-sweep (recommended) vs central RPC. Hardest tests live there.

Design: `docs/specs/2026-06-23-per-firm-database-durable-object-design.md`. Plan: `docs/specs/2026-06-23-per-firm-database-durable-object-implementation-plan.md` (10 tasks, 6 phases; Phase 4 relay re-homing = highest risk). ADR fragment: `docs/decisions/pending/per-firm-database-durable-object.md`.
Touch-overlap to coordinate: STATUS.md / ROADMAP.md (shared with slice-2-1-scan-engine, tools-metadata-scrubber).
