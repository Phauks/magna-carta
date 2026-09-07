import type { DurableObjectStorage } from "@cloudflare/workers-types";
import type { Migration } from "./migration.ts";
import type { MigrationTarget } from "./migration-runner.ts";

// MigrationTarget over a SQLite-backed Durable Object's storage. Sits beside d1-migration-target.ts.
// Atomicity uses transactionSync (the documented DO primitive); the applied-tags ledger is the same
// runner-managed _migrations table D1 uses (PRAGMA user_version is unsupported on DO SQLite).
const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

// WHICH migration, and WHICH statement in it. A migration that fails reports only SQLite's own
// sentence — "FOREIGN KEY constraint failed" and nothing else — and that sentence is the same for
// all ninety-odd migrations and every statement inside each one. Twice now a firm's database has
// been down while the runner held the two facts that would have named the fault and threw them away
// with the error it re-raised.
//
// The identity leads and the original message follows, because the fault surfaces through a bounded
// message head: what is most specific has to survive the truncation. The statement is cut to its
// opening keywords, which is what identifies it — `DROP TABLE` and `INSERT INTO role_permission`
// are different diagnoses and the first few words separate them.
const STATEMENT_HEAD_LENGTH = 60;

export function migrationStatementFailure(
  migration: Migration,
  index: number,
  cause: unknown,
): string {
  const statement = migration.statements[index] ?? "";
  const head = statement.replace(/\s+/gu, " ").trim().slice(0, STATEMENT_HEAD_LENGTH);
  const total = migration.statements.length;
  const message = cause instanceof Error ? cause.message : String(cause);
  return `${migration.tag} statement ${String(index + 1)}/${String(total)} [${head}] ${message}`;
}

export function doSqliteMigrationTarget(
  storage: DurableObjectStorage,
  now: () => string = () => new Date().toISOString(),
): MigrationTarget {
  const sql = storage.sql;
  return {
    appliedMigrationTags(): Promise<string[]> {
      sql.exec(CREATE_MIGRATIONS_TABLE);
      const rows = sql.exec("SELECT tag FROM _migrations ORDER BY tag").toArray() as {
        tag: string;
      }[];
      return Promise.resolve(rows.map((row) => row.tag));
    },
    applyMigration(migration: Migration): Promise<void> {
      // FOREIGN KEYS COME OFF OUT HERE, because SQLite only honours this pragma outside a
      // transaction — inside one it is a silent no-op that reports success and changes nothing.
      // Every table-rebuild migration writes `PRAGMA foreign_keys=OFF` in its own text believing it
      // works, and none of them ever did: the statements run inside transactionSync below. That
      // cost a firm its entire database. A rebuild drops the old table, DROP TABLE on a parent with
      // enforcement live fires a violation for every child row, and the migration failed — while
      // passing everywhere it was tested, because a database with no rows has no children to
      // orphan.
      //
      // The pragma is restored in `finally` so a failed migration cannot leave enforcement off for
      // the reads that follow it.
      sql.exec("PRAGMA foreign_keys=OFF");
      try {
        storage.transactionSync(() => {
          for (const [index, statement] of migration.statements.entries()) {
            try {
              sql.exec(statement);
            } catch (error) {
              throw new Error(migrationStatementFailure(migration, index, error), { cause: error });
            }
          }
          // What the disabled enforcement above owes back: with the constraints off for the length
          // of the migration, a genuine dangling reference would otherwise commit unnoticed. This
          // asks the whole database the question once, INSIDE the transaction, so a migration that
          // really did orphan a row aborts and rolls back rather than being discovered later by a
          // read that cannot explain itself.
          const violations = sql.exec("PRAGMA foreign_key_check").toArray();
          if (violations.length > 0) {
            throw new Error(
              `migration "${migration.tag}" left ${String(violations.length)} row(s) referencing a row that is not there`,
            );
          }
          sql.exec(
            "INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)",
            migration.tag,
            now(),
          );
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        sql.exec("PRAGMA foreign_keys=ON");
      }
      return Promise.resolve();
    },
    supersedeAppliedMigrations(
      supersededTags: readonly string[],
      replacementTag: string,
    ): Promise<void> {
      // Ledger rewrite only — no schema SQL. transactionSync makes the removals and the replacement
      // row atomic, same as applyMigration.
      try {
        storage.transactionSync(() => {
          for (const tag of supersededTags) sql.exec("DELETE FROM _migrations WHERE tag = ?1", tag);
          sql.exec(
            "INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)",
            replacementTag,
            now(),
          );
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
  };
}
