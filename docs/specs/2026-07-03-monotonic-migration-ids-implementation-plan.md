# Monotonic migration IDs + baseline collapse — implementation plan

**Status:** EXECUTED on branch `monotonic-migration-ids` (owner confirmed "no prod users yet, timestamp is good idea. commence"). Design: `2026-07-03-monotonic-migration-ids-design.md`; ADR: `docs/decisions/pending/monotonic-migration-ids.md`. This plan resolved the design's open sub-decisions and specified the coordinated execution. See **As-built** at the bottom for the two points where execution refined the plan.

## Current-state facts (verified on main `a28bb8f`, 2026-07-03)

- **Two lineages.** Control-plane: 7 migrations `0000_firm-registry`…`0006_natural_overlord`. Per-firm: 36 migrations `0000_foundational-tables`…`0035_seed-tools-decryption`. Journals at `packages/database/drizzle/{control-plane,per-firm}/meta/_journal.json`.
- **Seed trap is large.** 27 migrations carry `INSERT`s that a schema-only re-baseline would drop: control-plane `0001` (1); per-firm `0002`(6), `0003`(5), `0004`(23), `0006`(2), `0007`(1), `0008`(1), `0009`(7), `0010`(1), `0013`(1), `0015`(1), `0017`(10), `0018`(1), `0019`(5), `0020`(5), `0021`(2), `0022`(5), `0024`(1), `0025`(2), `0028`(1), `0029`(1), `0030`(1), `0031`(7), `0032`(5), `0034`(5), `0035`(5). These are role→permission grants (`tools:*`), default/lookup rows, and similar. Every one must survive.
- **Loader** (`packages/database/src/migration.ts`, `migrationsFromJournal`) currently orders by the journal's integer `idx`. Each journal entry already carries a `when` (epoch millis) and a `tag`.
- **Generation:** `pnpm --filter @magna-carta/database run generate-{control-plane,per-firm}-migrations` → `drizzle-kit generate --config=drizzle-{lineage}.config.ts`. drizzle-kit auto-assigns the next dense integer.
- **No CI dense-sequence check exists** (grep of `tooling/`, `.github/`, package scripts found none). Touchpoint 3 is additive only.
- **Coordination surface is minimal.** The only in-flight migration on any branch beyond main's chain is `file-repair-salvage`'s `per-firm/0036_file-repair-provenance.sql`. Everything else (decryption `0035`, service-status, etc.) is already merged to main.
- **Prerequisite (owner to confirm):** no firm onboarded — no per-firm D1 / Durable Object has applied the live chain. Consistent with "no prod users yet" (memory), but confirm the deployed state before executing; after onboarding the collapse becomes a live-data migration this plan does not cover.

## Resolved sub-decisions (owner: confirm or override)

1. **ID format = bare UTC timestamp + slug**, `YYYYMMDDTHHMMSS_slug` (e.g. `20260703T120400_baseline`). Not ULID. Rationale: human-readable, lexicographically sortable, industry standard (Rails/Django/Flyway); the slug carries context. ULID's extra collision-resistance is unneeded for hand-authored migrations and costs readability.
2. **Second precision, no sub-second suffix in the tag.** Two hand-authored migrations colliding to the same UTC second across this team is not a real risk; if it ever happens, the journal's `when` (millis) is the tiebreak. Keeps tags clean.
3. **Seeds = a separate companion `…_baseline_seed` migration per lineage**, applied immediately after the schema baseline (not folded into it). Rationale: the schema baseline stays pure drizzle-generated DDL (regenerable, diffable); the seeds live in one explicit, auditable file. **The seed is built from an END-STATE DATA DUMP, not by concatenating the legacy source `INSERT`s** — the dry-run (below) proved concatenation fails on both lineages (source INSERTs target table-rebuild temp tables like `__new_firm` and violate FK ordering when replayed against the final schema). Emit the seed by applying the full legacy chain to a scratch DB, then `SELECT *` each real user table and re-emit as `INSERT` statements in a stable order. Exclude FTS shadow tables (see below).
4. **Loader orders by `tag` ascending** (monotonic via the timestamp prefix), dropping reliance on the dense `idx`. `idx`/`when` stay in the journal for drizzle-kit compatibility but are not the order key.
5. **Acceptance gate = schema + data equivalence.** Build one SQLite DB from the full legacy chain and one from the new baseline+seed, per lineage; diff (a) the `sqlite_master` schema dump and (b) a full row-ordered data dump of every table. Byte-identical schema and identical seed rows is the pass condition.

## Dry-run validation (already done, dependency-free)

A `node:sqlite` dry-run (`packages/database/scripts/collapse-dry-run.mjs`, added on this branch) applied the real legacy chains to in-memory scratch DBs and verified the collapse **without touching any migration file**. Results (2026-07-03):

- **Legacy chains apply cleanly.** Control-plane: 26 schema objects / 12 real tables / 0 seed rows. Per-firm: 138 schema objects / 61 real tables / 104 seed rows.
- **The collapse reproduces the DB exactly** for both lineages: baseline schema (end-state DDL) + data-dump seed yields a byte-identical `sqlite_master` schema and identical row data to the full chain. **This validates the collapse approach and the acceptance gate.**
- **Source-INSERT concatenation FAILS** (both lineages) — hence sub-decision 3's data-dump seed. Do not use the design's originally-suggested concatenation.
- **FTS5 virtual tables need special handling.** `directory_name_fts` auto-creates shadow tables (`_data`/`_idx`/`_docsize`/`_config`); the baseline must emit only the `CREATE VIRTUAL TABLE` and **exclude the shadow tables** from both the schema replay and the seed (they are re-created and repopulated by the vtable). Re-run the dry-run to confirm the FTS index is queryable after seeding, since the seed carries base-table rows, not shadow-table rows.

The real execution's acceptance gate (B6) reuses this script's compare method, but against the **drizzle-kit-generated** baseline (from the TS schema) rather than the schema synthesized from the applied chain — that is the one thing the dependency-free dry-run could not exercise (drizzle-kit needs the dep install).

## Execution — Phase A: tooling touchpoints (low-risk, reversible)

Do these first; they are independently testable and don't touch existing migration files.

**A1 — Loader orders by tag.** In `migration.ts` `migrationsFromJournal`, change the sort from `(a,b)=>a.idx-b.idx` to `(a,b)=>a.tag.localeCompare(b.tag)` (or compare `when`). Add a unit test with out-of-`idx`-order entries whose tags sort correctly, asserting apply order follows the tag. Keep the existing `idx`-based test updated.

**A2 — Generation emits a timestamp ID.** drizzle-kit auto-numbers, so wrap generation with a post-process step: after `drizzle-kit generate`, rename the just-created `NNNN_slug.sql` → `<UTC-timestamp>_slug.sql`, rename its `meta/NNNN_snapshot.json`, and rewrite the new `_journal.json` entry's `tag` (leave `idx` as drizzle wrote it). Implement as a small `tooling/` node script invoked by the two `generate-*` package scripts. Verify by generating a throwaway no-op migration and confirming the timestamp name + journal tag.

**A3 — CI checks: update the migration-integrity guard + add a uniqueness check.** No standalone lint asserts dense numbering, but `packages/database/test/migration-integrity.test.ts` bakes in **two `00NN` assumptions the collapse breaks**, discovered while analyzing the harness: (a) `const snapshotIdx = … /^\d{4}_snapshot\.json$/` — a 4-digit snapshot-filename regex that timestamp IDs fail; (b) `REVIEWED_REBUILDS: Set<string>` — a hardcoded set of legacy `00NN` tags (`0001_auth-and-provisioning`, `0007_incident-description-nullable`, `0015_odd_mesmero`, `0021_outgoing_talon`, `0025_amusing_robbie_robertson`, `0029_scan_verdict_flagged`) that all vanish in the collapse. Update this test to accept timestamp-ID snapshot filenames and to re-seed `REVIEWED_REBUILDS` from the baseline (which contains no rebuilds — likely empties the set). Check `generated-migrations.test.ts` for the same. Then add a small fitness check asserting, per lineage, that every journal `tag` is unique and tags are strictly ascending in `idx` order (authoring order == lexical order).

## Execution — Phase B: the collapse (DESTRUCTIVE — gated on owner go-ahead)

Run per lineage (control-plane, then per-firm). All work on this branch (`monotonic-migration-ids`, fresh from main).

**B1 — Capture the reference.** Using the existing migration-runner harness against a temp SQLite, apply the FULL legacy chain and dump: schema (`SELECT type,name,sql FROM sqlite_master ORDER BY name`) and, for every user table, `SELECT * ORDER BY <all columns>`. Save as the acceptance reference (`reference-{lineage}.schema.sql` + `.data.txt`).

**B2 — Generate the schema baseline.** Point drizzle-kit at the current schema with an emptied `out` journal so it emits ONE migration = the full current schema (all `CREATE TABLE`/index/trigger). Rename to `<timestamp>_baseline`. Confirm it contains no `INSERT` (pure DDL).

**B3 — Build the baseline seed.** Extract every `INSERT` statement from the legacy chain in apply order (the 27 files above), concatenate into `<timestamp+1s>_baseline_seed.sql` with `--> statement-breakpoint` separators. Preserve exact values (esp. per-firm `0004`'s 23 rows and `0017`'s 10). Nothing else — no DDL.

**B4 — Reset the journal.** Rewrite `_journal.json` to exactly two entries per lineage: the baseline, then the baseline seed, with fresh `idx` 0/1, correct `when`, and the new tags.

**B5 — Delete the legacy chain.** Remove the old `00NN_*.sql` files and their `meta/00NN_snapshot.json`. Keep only the baseline + seed and their snapshot(s).

**B6 — ACCEPTANCE GATE (hard stop if it fails).** Build a fresh temp SQLite from the new baseline+seed via the migration-runner; dump schema+data as in B1; diff against the reference. Schema must be byte-identical; seed data must match row-for-row. Any diff = a dropped/altered seed or schema drift — do not proceed; fix and re-run. This gate is the whole safety of the collapse.

**B7 — Full suite.** Run the database package tests + the Miniflare worker integration test (which applies the chain). All green.

## Execution — Phase C: coordination (post-collapse, owner-run)

- **`file-repair-salvage`** re-authors its `0036_file-repair-provenance` as a timestamp-ID migration on top of the new baseline when it next syncs main. Its content is unchanged; only the ID/journal entry is re-expressed. No other stream is affected.
- Land this branch to main as the coordinated pass; from then on every new migration is authored with a timestamp ID via A2 and no branch renumbers again.

## Risks / gotchas

- **Seed loss** is the dominant risk; B3 + the B6 data-diff are the mitigation. Do not trust drizzle's re-baseline to carry seeds — it will not.
- **`when` for the new baselines** must be set at generation (drizzle sets it); confirm the journal `when` is present so ordering is stable.
- **drizzle-kit from-scratch generation** must emit the complete schema in one migration — verify B2's output covers every table/index/trigger present in the reference schema dump (the B6 schema diff catches misses).
- **Statement splitting**: the seed file must use the same `--> statement-breakpoint` convention the loader splits on (`migration.ts` `splitSqlStatements`), or D1's single-statement prepared execution breaks.
- Keep the two lineages fully independent throughout (separate journals, separate baselines) — never cross-apply.

## Not doing autonomously (why this plan stopped here originally)

The collapse rewrites the migration system (catastrophic if wrong), the seed re-expression spans 27 files, and sub-decisions 1–5 set a permanent scheme. Per the design's own "coordinated execution" mandate and the reversibility bar, Phase B executed only after the owner confirmed the prerequisite (no firm onboarded) and the resolved sub-decisions.

## As-built (what execution refined)

Executed 2026-07-04 (UTC). Two deliberate departures from the plan above, plus the outcome:

1. **Seed folded into the baseline, not a companion file (refines sub-decision 3 / B2–B4).** Each lineage collapsed to a **single** `20260704T041516_baseline` migration carrying DDL + the directory FTS5 virtual table and its three sync triggers + the seed `INSERT`s — not the planned two-entry (baseline + `_baseline_seed`) journal. A separate seed file forces a second drizzle snapshot in the chain for no benefit; one baseline is simpler and the acceptance gate validates it identically. The seed is still an **end-state data dump** (sub-decision 3's core finding holds — concatenating source `INSERT`s fails). Journals therefore have **one** entry per lineage, not two.
2. **Acceptance gate is LOGICAL schema equivalence, not byte-identical (refines sub-decision 5 / B6).** A byte-for-byte `sqlite_master` diff fails on cosmetic differences that are not schema differences: drizzle canonicalizes column order to the TS-schema order (vs the legacy incremental `ALTER` order) and quotes identifiers differently. The gate instead compares PRAGMA-normalized structure (`table_info`/`index_list`/`foreign_key_list`, ignoring column order, quoting, and auto-index names) plus a name-sorted full data dump. Logical schema + row-identical data is the pass condition. Both lineages passed.

**Outcome.** Both lineages collapsed (control-plane 7→1, per-firm 36→1 with 104 seed rows + FTS). Loader orders by tag (A1). Generation auto-stamps future migrations via `packages/database/scripts/timestamp-latest-migration.mjs`, wired into both `generate-*` package scripts (A2). Fitness function guards tag uniqueness/format/monotonicity; `REVIEWED_REBUILDS` emptied (the baselines rebuild nothing); obsolete per-step transform tests reconciled to the baseline (A3). Database suite 105 pass; data-access 137 pass. The worker Miniflare suite was not run in this worktree (unrelated: the decryption Rust→WASM `pkg/` is not built in a fresh checkout). **Phase C** (file-repair-salvage re-authoring `0036` onto the baseline; landing to main) is still owner-run.
