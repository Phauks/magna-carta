import { DurableObject } from "cloudflare:workers";
import { doSqliteMigrationTarget } from "@magna-carta/database/do-sqlite-migration-target";
import { doSqliteBatchDatabase } from "@magna-carta/database/do-sqlite-batch-database";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Bindings } from "../app.ts";
import { perFirmMigrations } from "../per-firm-migrations.ts";
import { isUniqueConflict, type CommitOutcome, type RpcStatement } from "./rpc-types.ts";

// One firm's per-firm database. Addressed idFromName(firmId): binding-free, created on first access,
// self-migrating on wake. The app Worker reaches it through firm-database-proxy.ts (the SqlDatabase
// the statement modules build against); this class only executes already-composed SQL + params.
export class FirmDatabase extends DurableObject<Bindings> {
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      await runPendingMigrations(doSqliteMigrationTarget(ctx.storage), perFirmMigrations());
    });
  }

  async runRead(sql: string, bindings: unknown[]): Promise<{ results: Record<string, unknown>[] }> {
    await this.ready;
    return doSqliteBatchDatabase(this.ctx.storage)
      .prepare(sql)
      .bind(...bindings)
      .all();
  }

  async runWrite(sql: string, bindings: unknown[]): Promise<{ changes: number }> {
    await this.ready;
    const result = await doSqliteBatchDatabase(this.ctx.storage)
      .prepare(sql)
      .bind(...bindings)
      .run();
    return { changes: result.meta.changes };
  }

  async commitBatch(statements: RpcStatement[]): Promise<CommitOutcome> {
    await this.ready;
    const database = doSqliteBatchDatabase(this.ctx.storage);
    const prepared = statements.map((s) => database.prepare(s.sql).bind(...s.bindings));
    try {
      await database.batch(prepared);
      return { ok: true };
    } catch (error) {
      // Translate the only conflict the effect path expects into a typed outcome. Anything else is a
      // real fault and must surface as a thrown RPC error (the worker maps it to a 500).
      if (isUniqueConflict(error, "idempotency_key.key"))
        return { ok: false, conflict: "idempotency_key" };
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
}
