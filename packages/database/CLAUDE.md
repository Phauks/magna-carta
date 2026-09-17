# @magna-carta/database — CLAUDE.md

**Purpose.** The schema package: the two drizzle table definitions (control-plane and per-firm), the
generated SQL migration lineages that build them, and the runtime that applies those migrations to a
database. It holds no queries and no business logic — reads and writes go through
`@magna-carta/data-access`.

**White paper:** _Tenancy and data isolation_ and _Schema migration & the database fleet_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0003.)
**Control-plane migration operations** (how they reach production): the _Control-plane database
migrations_ section of [`docs/conventions/operations.md`](../../docs/conventions/operations.md).

## Key files / entry points

- `src/control-plane-schema.ts` / `src/per-firm-schema.ts` — the two schemas; one drizzle-kit lineage
  each, versioned independently
- `drizzle/<lineage>/` — the committed lineage: `<timestamp>_<slug>.sql` migrations plus
  `meta/_journal.json` and `meta/NNNN_snapshot.json`
- `src/migration.ts` — the runtime `Migration` shape and the journal reader (no filesystem: Workers
  import the SQL as raw text)
- `src/migration-runner.ts` — pending-migration application against a `MigrationTarget`
- `src/d1-migration-target.ts` / `src/do-sqlite-migration-target.ts` / `src/node-sqlite.ts` — the
  targets: D1, a Durable Object's SQLite, and node:sqlite for tests and fixtures
- `src/protected-columns.ts` — the registry of encrypted-at-rest columns
- `src/declared-tables.ts` — what each lineage's TypeScript declares, as plain data. The one place
  drizzle's table reflection is done for a caller outside this package
- `scripts/timestamp-latest-migration.mjs` — renames a fresh `NNNN_slug` migration to a timestamp id
- `scripts/refresh-snapshot.mjs` — re-derives a lineage's snapshot from the schema (below)
- `scripts/collapse-baseline.mjs` — folds a whole chain into one baseline, and proves it: the file is
  DUMPED from a database built by applying the chain, never written by hand, and `--verify` applies
  both and compares every object and every seeded row

## Local conventions

- **Migration ids are UTC timestamps, and the TAG is the apply order — not `idx`.**
  `generate-*-migrations` runs drizzle-kit and then rewrites the new `NNNN_slug` migration to
  `YYYYMMDDThhmmss_slug`, so two branches never collide on a number. `migrationsFromJournal` sorts
  the journal lexically **by tag**, so that is the order every database applies in. `idx` is
  drizzle's dense counter — the order migrations were INTEGRATED in — and it names the `meta/`
  snapshots, which stay on their `NNNN_` names because that is what drizzle diffs by. Three modules
  in this repo used to say `idx` was the apply order; all three were wrong, and that belief is what
  let two inversions merge in September 2026.
- **After merging `main` into a branch that adds a migration, RE-STAMP it.** A branch cut on Monday
  and merged on Wednesday keeps Monday's timestamp while drizzle renumbers its `idx` to the end —
  and since apply order is by tag, a fresh database then runs it before the migrations it was
  written on top of, building its schema in an order no already-migrated firm ever used. Two of
  those reached `main` in September 2026. Two commands, and the second is the general one:

  ```
  node scripts/timestamp-latest-migration.mjs <lineage>     # ONE migration, at the end of the lineage
  node ../../tooling/resolve-journal/index.mjs [<lineage>]  # the journal itself: a live conflict, or a repair
  ```

  `resolve-journal` is what a conflicted `_journal.json` is for. Resolving that conflict by hand
  looks trivial — two adjacent entries, keep both — and is wrong twice over: `idx` is a dense
  counter naming the `meta/` snapshots, so the union leaves two entries sharing one, and the
  branch's migration keeps a tag that now sorts below the head. It reads git's conflict stages, or
  the journal on disk when there is no conflict, keeps every tag that is on `main` (`main` is
  production, so those have deployed and are immutable), appends the rest in the order they were
  integrated, re-stamps each one above the head, renames the `.sql` to match, and regenerates the
  worker bundles. `--dry-run` prints the plan. Both commands are idempotent and both print every
  rename. `tooling/migration-integrity` refuses the lineage on **every change** — in the pre-push
  hook and in the gate's governance dimension — if the re-stamp is skipped. It used to be a Vitest
  fitness function only, which the hosted gate of the time ran solely when asked.

- **Never renumber `idx` to fix an ordering complaint.** The snapshots are named for it and describe
  the schema at that point; reordering `idx` makes each one describe a state its name denies. Move
  the TAG.
- **A tag is immutable once it is on `main`, because `main` is production.** Re-stamping is free
  only before the migration deploys. The applied-ledger in every database records the TAG, not the
  SQL behind it, so an edit to a deployed migration is never seen by the databases that already ran
  it, and a rename leaves them holding a tag this code cannot recognise — which the runner refuses,
  blocking every later migration for the life of that database. Neither is fixed by deploying
  again. `pnpm run lint:migration-immutability` refuses both on every pull request, measured from
  where the branch left `main`. Two things are **not** exceptions and need no entry anywhere,
  because the runtime reconciles them and the gate reads its lists directly: a baseline collapse
  (`src/legacy-baselines.ts`) and a re-stamp (`src/re-stamped-migrations.ts`). Everything else that
  is deliberate goes in `tooling/migration-immutability/allowed-changes.mts` with the reason no
  database could have applied it.
- **If you do re-stamp a deployed tag, record it in `src/re-stamped-migrations.ts` in the same
  commit.** That is what turns the refusal into a one-time ledger rewrite on the next wake, instead
  of a database that has to be recreated. A rename moves the id and not the SQL, so the schema a
  database already has is the schema the new id names and the rewrite asserts nothing new — which is
  also why the registry is **only** for a pure rename: a tag whose SQL also changed is not a
  re-stamp, and an entry for one would claim a schema the database does not have. Append a new
  migration instead. Do not reach for "the affected databases can just be recreated": that is a
  claim about the whole fleet, and the 2026-09-15 rename was taken on it and was wrong — a firm
  database had applied one of the two retired ids and refused to wake from the moment the rename
  deployed.
  `docs/deploy-queue.md` records that rename and what it actually cost.
- **Hand-written migrations are normal here.** Partial indexes with a `WHERE`, FTS5 virtual tables
  and their triggers, seed `INSERT`s, and column adds that must land in a specific order are written
  by hand and appended to the journal — drizzle-kit cannot express them, or expresses them as a
  destructive table rebuild. The schema file and the migration are then both authored deliberately.
- **Additive only (expand-contract).** No destructive DDL against a table that holds data; see
  `test/expand-contract.test.ts`.
- **A vocabulary on a PARENT table grows by adding a column, never by widening its CHECK.** SQLite
  cannot alter a CHECK, so changing one costs a table rebuild — and a rebuild drops the table it
  replaces, which a durable object refuses at the commit for every child row. A leaf table rebuilds
  normally; a table anything references does not, and there is no pragma around it: six mechanisms
  are probed in `apps/api-worker/test/durable-object-pragma-context.test.ts` and all six fail,
  `writable_schema` included (workerd's authorizer answers `SQLITE_AUTH`). `ALTER TABLE … ADD COLUMN`
  drops nothing, lands on a parent, may carry its own CHECK and may name a second column in it — all
  four proved in that same file. So: add the column, backfill in the same migration, narrow the old
  column's meaning in its comment, and leave it where it stands. Dropping it is the same rebuild.
  Home: ADR-a-vocabulary-on-a-parent-table-grows-by-adding-a-column; worked case,
  `drizzle/per-firm/20260914T120000_task-rungs-and-archive.sql`.
- **A data migration is tested against ROWS, not against an empty database.** An UPDATE that maps one
  column onto another is indistinguishable from a correct one when there is nothing to map;
  `test/task-rungs-migration.test.ts` is the shape — seed at the pre-migration schema, apply the rest
  of the lineage, assert what each row became. `test/rebuilds-over-populated-data.test.ts` does the
  same for rebuilds.
- **A new migration file is registered in the WORKER too — by the generator, not by hand.** Workers
  have no filesystem, so the SQL is imported as raw text. `apps/api-worker/src/per-firm-migrations.ts`
  and its control-plane sibling carry that import list, and both are **generated from the journal**:
  run `pnpm run migration-bundles` and commit what it writes. Hand-editing them is how the list used
  to lose an entry — a merge resolved the journal cleanly, because its entries are adjacent lines,
  and dropped one branch's import in the same conflict, after which every firm database failed to
  wake with "is in the journal but its SQL was not provided". `pnpm run lint:migration-bundles` runs
  on every pull request and fails when a module and its journal disagree.
- **The lineages never merge.** A per-firm change goes only into `drizzle/per-firm`, a platform
  change only into `drizzle/control-plane`; auth tables exist solely in the control plane.

## The snapshot rule — keep `meta/` at the lineage head

`drizzle-kit generate` diffs the schema against **the highest-numbered snapshot in `meta/`**, not
against the journal. It writes a snapshot only as a side effect of emitting a migration, so every
hand-written migration advances the journal while the snapshot stands still. Once the snapshot lags,
the next `generate` re-emits every table added since it — a migration that would fail on any firm
already provisioned — which is how the fleet ends up hand-writing migrations forever.

**So: after a hand-written migration, refresh the snapshot in the same commit.**

```
pnpm --filter @magna-carta/database run refresh-per-firm-snapshot        # or refresh-control-plane-snapshot
pnpm --filter @magna-carta/database run check-snapshots                  # dry run both lineages; exits 1 on drift
```

`scripts/refresh-snapshot.mjs` copies `meta/` into a scratch out-folder, runs `drizzle-kit generate`
**there** (so the throwaway `.sql` never lands in `drizzle/`), and adopts only the snapshot it
produced — filed under the journal head's idx, with its `prevId` still pointing at the previous
snapshot, so the chain stays unbroken. It then re-runs the same generate against the repaired `meta/`
and fails if anything is still emitted, so the script proves its own repair. With no drift it writes
nothing and reports "already current"; it deletes its scratch folder either way.

To confirm a repair by hand: `generate-per-firm-migrations` on an unchanged schema must print
"No schema changes, nothing to migrate", and adding one scratch column must emit that one
`ALTER TABLE ... ADD` and nothing else.

**This is gated, not reviewed.** `check-snapshots` runs in `pnpm check:scoped` whenever the change
touches this package, in the whole-repo `pnpm check`, and in the CI gate's `governance` job beside the
migration-integrity guard — so a stale snapshot fails before it lands rather than surfacing weeks later
in someone else's `generate`. It drifted twice unnoticed before that wiring existed, both times because
the rule above was a rule a reviewer had to remember. Nobody has to remember it now; do not re-add it as
a review step.

## Invariants that apply here

- **A migration is immutable once committed.** Firms have already applied it. Corrections are new
  migrations, never edits to an existing `.sql` or a renumbered journal entry. A baseline COLLAPSE is
  the one thing that retires committed migrations, and it does not edit them: it replaces the chain
  with the schema the chain produced and records the retired ids in `LEGACY_BASELINES`, so a database
  carrying them reconciles rather than being read as a newer schema.
- **A table other tables point at cannot be rebuilt.** The `__new_X` copy/drop/rename pattern drops
  the table it replaces, and a durable object enforces foreign keys at the statement AND at the
  commit — `PRAGMA foreign_keys` is a no-op inside a migration's execution context, which Cloudflare
  documents for D1 in the same terms ("user queries cannot change this during a query or migration").
  `defer_foreign_keys` holds the violation to the commit and the commit still rejects it. Four
  approaches were tried against real durable-object storage and all four fail; the probes are
  `apps/api-worker/test/durable-object-pragma-context.test.ts`. `tooling/migration-integrity` refuses
  the shape outright, so widening a CHECK or dropping a column on a parent table needs a different
  answer — not a cleverer rebuild.
- **The journal's structure is checked.** `idx` is dense from 0, every entry has its `.sql`, and
  every snapshot maps to a journal idx — asserted by `tooling/migration-integrity/`, which also
  applies the whole chain to a fresh SQLite and rejects any unreviewed destructive table rebuild. It lives outside
  this package because it is a plain node script rather than a test: `node tooling/migration-integrity/index.mts`
  runs it in under a second, which is what lets the pre-push hook and the CI gate take it as a
  fail-fast without standing up a test runner. Its Vitest twin, driving the same module, runs with the
  normal suite. The reviewed-table-rebuild allowlist is `REVIEWED_REBUILDS` in `checks.mts`.
- **Protected columns hold ciphertext only.** A column listed in `src/protected-columns.ts` is
  written and read exclusively through the data-access `protected()` chokepoint.
- **No cross-firm reachability.** The per-firm schema carries no firm id and no auth table; isolation
  is the database boundary itself, not a column.

## Out-of-order arrivals

**The pull-request gate is the answer to this; what follows is the backstop behind it.** An
inversion is caught by `applyOrderViolations` while the tag still costs nothing to change, and the
remedy is the re-stamp above. This section is about one that got past that — as two did before the
gate existed — and therefore reached a database, where the tag can no longer be moved.

A database that woke between the two merges has already moved past where the newcomer sorts, so it
applies the pair in the order it met them while a database provisioned afterwards applies them in
tag order. For independent migrations both orders reach the same schema and nothing is wrong, which
is the usual case and why this is **reported rather than refused**: the migration is genuinely
pending and genuinely needed, and stranding a database over it would be worse than the condition.
For migrations that touch the same objects the two orders do not agree, and the damage is silent:
one set of firms carries a schema the other does not, with no failure anywhere to point at it.

`runPendingMigrations` names it on the report (`outOfOrderTags`, with `ledgerHead`), measured against
the ledger BEFORE the batch lands — afterwards every tag is in the ledger and which of them arrived
late is not recoverable from it. A firm database holds it for its diagnostic read
(`migrationState().outOfOrderArrivals`); the control-plane pass emits one
`migration.arrivedOutOfOrder` event per tag.

**What to do when one is reported:** compare the two migrations. If they touch different objects,
nothing is wrong and the report is noise. If they touch the same ones, the firms that took them in
each order now differ, and the repair is a new migration that converges them. Not a re-stamp: that
is the remedy on a pull request, before anything has applied the tag, and by the time this report
exists a database has. Moving it then is a hard refusal on wake for every database holding the old
one.

## Dependencies & contracts

- Depends on `@magna-carta/identifiers` (branded id types on schema columns) and `drizzle-orm`;
  `drizzle-kit` is a dev dependency and never ships.
- Consumed by `@magna-carta/data-access` (the only query layer), the worker's provisioning and
  scheduled handlers (which run `runPendingMigrations`), and the fixtures harness.
- The generated SQL is exported through `./drizzle/*` and imported as raw text by Worker bundles —
  nothing in this package reads the filesystem except `src/node-sqlite.ts` (dev/test only) and the
  scripts.

## Gotchas

- **The drizzle schema is not the whole database.** Raw partial indexes (`custody_*_review_index`,
  `index_split_document_version_unique`), the `directory_name_fts` FTS5 table and its shadow tables,
  and a self-referencing foreign key on `custody_location.parent_location_id` exist in the migrations
  but not in the TypeScript schema, so no snapshot records them and no generate will ever reproduce
  them. Anything that compares the
  applied chain against the schema must expect those extras — the guard that does
  (`tooling/migration-integrity/checks.mts`) enumerates them in `UNDECLARED_BY_DESIGN` by exact name
  rather than by prefix, so a NEW undeclared table is a finding rather than something the rule
  swallows. Conversely
  `document_template.current_version_id` declares a foreign key the migration deliberately omits (it
  would close a cycle with `document_template_version`).
- **`drizzle-kit generate` refuses `--config` alongside any other flag**, and resolves `--out`
  against the working directory — an absolute path is rejected. That is why the refresh script
  spells out `--dialect`/`--schema` (read out of the config file) and uses a relative scratch path.
- **A snapshot is not a migration.** Refreshing the snapshot changes what the _next_ generate emits;
  it never changes what any database has applied. If the schema and the committed migrations have
  genuinely diverged, refreshing the snapshot hides the difference — it re-derives the snapshot FROM
  the TypeScript, so both then agree with each other and disagree with every database. That
  comparison is no longer a manual step: `tooling/migration-integrity/` applies each lineage to
  node:sqlite and diffs it against `src/declared-tables.ts`, naming the table or column that
  disagrees. A divergence it reports is fixed with a new migration, never by refreshing the snapshot.
- **`vp test` runs the whole repo.** For this package alone use
  `pnpm --filter @magna-carta/database run test`, and never run two test invocations at once.
