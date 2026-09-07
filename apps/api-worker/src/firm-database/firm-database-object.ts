import { DurableObject } from "cloudflare:workers";
import { doSqliteMigrationTarget } from "@magna-carta/database/do-sqlite-migration-target";
import { doSqliteBatchDatabase } from "@magna-carta/database/do-sqlite-batch-database";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Bindings } from "../app.ts";
import { perFirmMigrations } from "../per-firm-migrations.ts";
import { uniqueConstraintColumns, type CommitOutcome, type RpcStatement } from "./rpc-types.ts";

// One firm's per-firm database. Addressed idFromName(firmId): binding-free, created on first access,
// self-migrating on wake. The app Worker reaches it through firm-database-proxy.ts (the SqlDatabase
// the statement modules build against); this class only executes already-composed SQL + params.
export class FirmDatabase extends DurableObject<Bindings> {
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

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      try {
        await runPendingMigrations(doSqliteMigrationTarget(ctx.storage), perFirmMigrations());
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
    try {
      await database.batch(prepared);
      return { ok: true };
    } catch (error) {
      // Translate any UNIQUE violation into a typed outcome carrying its column list, so conflict
      // detection never depends on the SQLite message surviving RPC. Anything else is a real fault
      // and must surface as a thrown RPC error (the worker maps it to a 500).
      const columns = uniqueConstraintColumns(error);
      if (columns !== null) return { ok: false, uniqueConstraint: columns };
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
