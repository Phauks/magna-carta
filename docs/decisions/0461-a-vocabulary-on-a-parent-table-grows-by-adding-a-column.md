---
number: 461
slug: a-vocabulary-on-a-parent-table-grows-by-adding-a-column
status: Accepted
date: 2026-09-14
area: Database / schema migrations
summary: A closed vocabulary held as a CHECK on a table other tables reference is never widened in place; the new vocabulary arrives as an added column and the old one is retired where it stands.
---

A closed vocabulary held as a CHECK on a table other tables reference is never widened in place. The
new vocabulary arrives as an added column, and the old column is retired where it stands rather than
dropped.

## Why

SQLite cannot alter a CHECK. The only way to change one is to rebuild the table — create a
replacement, copy, drop the original, rename — and a rebuild drops the table it replaces. In a
Cloudflare Durable Object, foreign keys are enforced at the statement **and** at the commit, so that
drop fires a violation for every child row and the object resets rather than allowing it. A firm
whose database holds data therefore cannot take the migration, while an empty one takes it happily:
the migration passes every test and fails on wake, which is how a firm's database sat unreachable for
a day.

Six mechanisms were probed against real durable-object storage, and all six fail
(`apps/api-worker/test/durable-object-pragma-context.test.ts`):

1. `PRAGMA foreign_keys=OFF` in the migration's own context — ignored inside the implicit
   transaction, and SQLite reports success either way.
2. The same pragma with a yield between it and the drop.
3. `PRAGMA defer_foreign_keys=ON` — defers honestly, and the violation is still outstanding at the
   commit.
4. Renaming the original aside under `PRAGMA legacy_alter_table=ON`.
5. Both of the last two together, which is the combination each half was missing.
6. Editing `sqlite_schema` under `PRAGMA writable_schema` — SQLite's own documented way to change a
   constraint with nothing dropped. workerd's authorizer refuses it outright: `SQLITE_AUTH`.

That exhausts the mechanisms. It is not a gap waiting for a cleverer migration.

## What is decided

`ALTER TABLE … ADD COLUMN` drops nothing, so it lands on a parent with children and needs no pragma.
The same probe file proves the three properties the route rests on: the added column may carry its own
CHECK, that CHECK may name a second column, and existing rows take the default.

So a vocabulary change on a parent table is:

1. Add the new column, with its CHECK and its default.
2. Backfill the existing rows from the old column in the same migration.
3. Narrow the old column's MEANING in the schema file, and say in its comment that the retired values
   are never written again.
4. Leave the old column and its CHECK in place. Dropping a column is the same rebuild.

The cost is a column that outlives its use, and it is the right cost: a dead column is inert, and the
alternative is a migration that cannot be deployed. The first application is `matter_task`, whose
`state` narrowed to "is the work finished" when the four rungs arrived as `progress`
(`20260914T120000_task-rungs-and-archive`).

## What this does not say

A LEAF table — one nothing references — is rebuilt normally, and that remains the ordinary answer
there; `invoice_wip_claim` is the worked case, proved inside a real durable object by
`apps/api-worker/test/leaf-rebuild-in-durable-object.test.ts`.

It also does not license a second column for a fact the first one already holds. The task rungs split
across two columns because `done` carries a completion actor and instant that the database pairs with
`state` by CHECK; the three open rungs carry nothing but themselves. Where a new vocabulary genuinely
replaces an old one, the old column stops being written and stops being read, and one function
resolves the reader's vocabulary from whatever holds it.
