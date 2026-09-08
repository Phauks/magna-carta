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
- `scripts/timestamp-latest-migration.mjs` — renames a fresh `NNNN_slug` migration to a timestamp id
- `scripts/refresh-snapshot.mjs` — re-derives a lineage's snapshot from the schema (below)
- `scripts/collapse-baseline.mjs` — folds a whole chain into one baseline, and proves it: the file is
  DUMPED from a database built by applying the chain, never written by hand, and `--verify` applies
  both and compares every object and every seeded row

## Local conventions

- **Migration ids are UTC timestamps, snapshots keep their idx.** `generate-*-migrations` runs
  drizzle-kit and then rewrites the new `NNNN_slug` migration to `YYYYMMDDThhmmss_slug`, so two
  branches never collide on a number. The journal keeps a dense `idx` (apply order); the `meta/`
  snapshots stay on their `NNNN_` names because that is what drizzle diffs by.
- **Hand-written migrations are normal here.** Partial indexes with a `WHERE`, FTS5 virtual tables
  and their triggers, seed `INSERT`s, and column adds that must land in a specific order are written
  by hand and appended to the journal — drizzle-kit cannot express them, or expresses them as a
  destructive table rebuild. The schema file and the migration are then both authored deliberately.
- **Additive only (expand-contract).** No destructive DDL against a table that holds data; see
  `test/expand-contract.test.ts`.
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
- **The journal is the apply order.** `idx` is dense from 0, every entry has its `.sql`, and every
  snapshot maps to a journal idx — asserted by `tooling/migration-integrity/`, which also applies the
  whole chain to a fresh SQLite and rejects any unreviewed destructive table rebuild. It lives outside
  this package because it is a plain node script rather than a test: `node tooling/migration-integrity/index.mts`
  runs it in under a second, which is what lets the pre-push hook and the CI gate take it as a
  fail-fast without standing up a test runner. Its Vitest twin, driving the same module, runs with the
  normal suite. The reviewed-table-rebuild allowlist is `REVIEWED_REBUILDS` in `checks.mts`.
- **Protected columns hold ciphertext only.** A column listed in `src/protected-columns.ts` is
  written and read exclusively through the data-access `protected()` chokepoint.
- **No cross-firm reachability.** The per-firm schema carries no firm id and no auth table; isolation
  is the database boundary itself, not a column.

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
  applied chain against the schema must expect those extras. Conversely
  `document_template.current_version_id` declares a foreign key the migration deliberately omits (it
  would close a cycle with `document_template_version`).
- **`drizzle-kit generate` refuses `--config` alongside any other flag**, and resolves `--out`
  against the working directory — an absolute path is rejected. That is why the refresh script
  spells out `--dialect`/`--schema` (read out of the config file) and uses a relative scratch path.
- **A snapshot is not a migration.** Refreshing the snapshot changes what the _next_ generate emits;
  it never changes what any database has applied. If the schema and the committed migrations have
  genuinely diverged, refreshing the snapshot hides the difference — check the chain against the
  schema first (apply the lineage to node:sqlite and compare `PRAGMA` output), then fix it with a new
  migration.
- **`vp test` runs the whole repo.** For this package alone use
  `pnpm --filter @magna-carta/database run test`, and never run two test invocations at once.
