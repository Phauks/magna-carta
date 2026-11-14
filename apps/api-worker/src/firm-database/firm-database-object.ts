import { StoredSecretsDurableObject } from "../stored-secrets.ts";
import { doSqliteMigrationTarget } from "@magna-carta/database/do-sqlite-migration-target";
import { doSqliteBatchDatabase } from "@magna-carta/database/do-sqlite-batch-database";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Bindings } from "../bindings.ts";
import { perFirmMigrations } from "../per-firm-migrations.ts";
import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import { uniqueConstraintColumns, type CommitOutcome, type RpcStatement } from "./rpc-types.ts";

/*
 * THE RESTORE POINT: one row naming the instant before the last migration batch.
 *
 * Cloudflare can restore a durable object to a bookmark, which is what makes a migration reversible
 * at all — the lineage itself only runs forwards, so a migration that succeeds and turns out to be
 * wrong has no undo of its own. Keeping the bookmark beside the ledger is what turns "restore this
 * firm to before that deploy" from an archaeology problem into a value somebody can read off the
 * diagnostics panel.
 *
 * One row, replaced each batch. Older bookmarks are not kept: Cloudflare's retention window is what
 * actually bounds how far back an object can go, and a list of bookmarks older than that window
 * would be a list of restore points that no longer restore anything.
 */
const CREATE_RESTORE_POINT_TABLE =
  "CREATE TABLE IF NOT EXISTS _migration_restore_point (" +
  "id INTEGER PRIMARY KEY CHECK (id = 1), bookmark TEXT NOT NULL, taken_at TEXT NOT NULL, " +
  "applied_tags TEXT NOT NULL)";

interface RestorePoint {
  readonly bookmark: string;
  readonly takenAt: string;
  readonly appliedTags: string[];
}

/** Which migrations this wake is about to apply, so the restore point can name them. */
async function pendingTags(
  target: { appliedMigrationTags(): Promise<string[]> },
  migrations: readonly { tag: string }[],
): Promise<string[]> {
  try {
    const applied = new Set(await target.appliedMigrationTags());
    return migrations.filter((migration) => !applied.has(migration.tag)).map((m) => m.tag);
  } catch {
    // The ledger could not be read. The runner is about to fail on the same thing and say so
    // properly; this read only decides whether to take a bookmark.
    return [];
  }
}

function recordRestorePoint(
  storage: DurableObjectState["storage"],
  bookmark: string,
  appliedTags: readonly string[],
): void {
  try {
    storage.sql.exec(CREATE_RESTORE_POINT_TABLE);
    storage.sql.exec(
      "INSERT INTO _migration_restore_point (id, bookmark, taken_at, applied_tags) VALUES (1, ?1, ?2, ?3) " +
        "ON CONFLICT(id) DO UPDATE SET bookmark = ?1, taken_at = ?2, applied_tags = ?3",
      bookmark,
      new Date().toISOString(),
      JSON.stringify(appliedTags),
    );
  } catch {
    // Recording the restore point must never fail the migration that succeeded. A firm on the right
    // schema with no restore point is a worse diagnostic, not a worse database.
  }
}

function readRestorePoint(storage: DurableObjectState["storage"]): RestorePoint | null {
  try {
    storage.sql.exec(CREATE_RESTORE_POINT_TABLE);
    const rows = storage.sql
      .exec("SELECT bookmark, taken_at, applied_tags FROM _migration_restore_point WHERE id = 1")
      .toArray() as { bookmark: string; taken_at: string; applied_tags: string }[];
    const row = rows[0];
    if (row === undefined) return null;
    const tags: unknown = JSON.parse(row.applied_tags);
    return {
      bookmark: row.bookmark,
      takenAt: row.taken_at,
      appliedTags: Array.isArray(tags) ? (tags as string[]) : [],
    };
  } catch {
    return null;
  }
}

// One firm's per-firm database. Addressed idFromName(firmId): binding-free, created on first access,
// self-migrating on wake. The app Worker reaches it through firm-database-proxy.ts (the SqlDatabase
// the statement modules build against); this class only executes already-composed SQL + params.
export class FirmDatabase extends StoredSecretsDurableObject {
  private readonly ready: Promise<void>;
  /**
   * Why the lineage could not be applied, or null when it was.
   *
   * RECORDED RATHER THAN RETHROWN, which is the whole point of it. A constructor that rejects takes
   * the entire object with it: every read, every write, and — because the diagnostic reads are
   * firm-scoped like everything else — the surfaces whose only job is to explain what happened. One
   * statement in one migration then puts a firm completely dark, and the fault that did it is
   * legible nowhere. That happened twice in a day.
   *
   * So the object comes up either way. What the fault costs is BUSINESS data, which stays refused:
   * the schema here is at a consistent state, but an older one than this build's code was written
   * against, and serving reads across that gap trades an outage for wrong answers. What it no longer
   * costs is the ability to ask what is wrong.
   */
  private migrationFault: string | null = null;

  /*
   * Migrations that reached THIS database behind its own ledger head — two branches merged and
   * seated one behind a migration this firm had already applied, so it met the pair in a different
   * order than a firm provisioned afterwards will. Held because it is unrecoverable once the batch
   * lands: the ledger is a set of tags, and which of them arrived late is nowhere in it.
   *
   * Not a fault. The database is migrated and serves normally; this is the diagnostic that lets
   * somebody compare the two orders while the question is still answerable.
   */
  private outOfOrderArrivals: string[] = [];

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const target = doSqliteMigrationTarget(ctx.storage);
      const migrations = perFirmMigrations();

      // THE RESTORE POINT, taken before anything is applied.
      //
      // A migration that FAILS needs no restore: workerd rolls the whole context back, so the
      // database is exactly as it was and the row written below goes with it. The case this exists
      // for is the other one — a migration that succeeds and is WRONG, which is unrecoverable
      // otherwise because the lineage only runs forwards. A bookmark taken here names the instant
      // before the change, and Cloudflare can restore the object to it.
      //
      // Taking it is best-effort on purpose. A bookmark that cannot be read is a reason to migrate
      // without a restore point and say so, not a reason to leave a firm on an old schema.
      const pending = await pendingTags(target, migrations);
      let bookmark: string | null = null;
      if (pending.length > 0) {
        try {
          bookmark = await ctx.storage.getCurrentBookmark();
        } catch {
          bookmark = null;
        }
      }

      try {
        const report = await runPendingMigrations(target, migrations);
        this.outOfOrderArrivals = report.outOfOrderTags;
        if (bookmark !== null) recordRestorePoint(ctx.storage, bookmark, pending);
      } catch (error) {
        this.migrationFault = error instanceof Error ? error.message : String(error);
      }
    });
  }

  /**
   * The gate every business call passes. Fails CLOSED on an unmigrated database, carrying the fault
   * so the refusal explains itself rather than surfacing as a bare platform error.
   */
  private async serviceable(): Promise<void> {
    await this.ready;
    if (this.migrationFault !== null) {
      throw new Error(`the firm database is not migrated: ${this.migrationFault}`);
    }
  }

  /**
   * What the diagnostic reads ask, and the one call that answers on a database too broken to serve
   * anything else. Never gated on `serviceable`: a question about the fault cannot be refused
   * because of the fault.
   */
  async migrationState(): Promise<{
    fault: string | null;
    appliedCount: number;
    appliedHead: string | null;
    outOfOrderArrivals: string[];
    restorePoint: { bookmark: string; takenAt: string; appliedTags: string[] } | null;
  }> {
    await this.ready;
    // The ledger is the runner's own table and exists before any migration in the lineage runs, so
    // it is readable at every state this object can be in — including one that applied nothing.
    let applied: string[] = [];
    try {
      applied = (
        this.ctx.storage.sql.exec("SELECT tag FROM _migrations ORDER BY tag").toArray() as {
          tag: string;
        }[]
      ).map((row) => row.tag);
    } catch {
      // No ledger at all: a database that failed before the runner could create one.
    }
    return {
      fault: this.migrationFault,
      appliedCount: applied.length,
      appliedHead: applied.at(-1) ?? null,
      outOfOrderArrivals: this.outOfOrderArrivals,
      restorePoint: readRestorePoint(this.ctx.storage),
    };
  }

  async runRead(sql: string, bindings: unknown[]): Promise<{ results: Record<string, unknown>[] }> {
    await this.serviceable();
    return doSqliteBatchDatabase(this.ctx.storage)
      .prepare(sql)
      .bind(...bindings)
      .all();
  }

  async runWrite(sql: string, bindings: unknown[]): Promise<{ changes: number }> {
    await this.serviceable();
    const result = await doSqliteBatchDatabase(this.ctx.storage)
      .prepare(sql)
      .bind(...bindings)
      .run();
    return { changes: result.meta.changes };
  }

  async commitBatch(statements: RpcStatement[]): Promise<CommitOutcome> {
    await this.serviceable();
    const database = doSqliteBatchDatabase(this.ctx.storage);
    const prepared = statements.map((s) => database.prepare(s.sql).bind(...s.bindings));
    const guards = new Map<number, string>();
    for (const [index, statement] of statements.entries()) {
      if (statement.guard !== undefined) guards.set(index, statement.guard);
    }
    try {
      await database.batch(prepared, guards.size > 0 ? { guards } : undefined);
      return { ok: true };
    } catch (error) {
      // Translate any UNIQUE violation into a typed outcome carrying its column list, so conflict
      // detection never depends on the SQLite message surviving RPC. Anything else is a real fault
      // and must surface as a thrown RPC error (the worker maps it to a 500).
      const columns = uniqueConstraintColumns(error);
      if (columns !== null) return { ok: false, uniqueConstraint: columns };
      // A guarded statement matched no row. The adapter raised from inside transactionSync, so the
      // batch is already fully rolled back — this only carries the reason back out.
      if (error instanceof GuardedWriteRefusedError) {
        return { ok: false, unaffectedGuard: error.guard };
      }
      throw error;
    }
  }

  tableCountForTest(): Promise<number> {
    return this.ready.then(
      () =>
        (
          this.ctx.storage.sql
            .exec("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
            .one() as { c: number }
        ).c,
    );
  }

  // The applied-migration tags the self-migration recorded, so a test can assert the full per-firm
  // lineage ran (not just that some tables exist) and catch a partial-lineage regression.
  appliedMigrationTagsForTest(): Promise<string[]> {
    return this.ready.then(() =>
      (
        this.ctx.storage.sql.exec("SELECT tag FROM _migrations ORDER BY tag").toArray() as {
          tag: string;
        }[]
      ).map((row) => row.tag),
    );
  }
}
