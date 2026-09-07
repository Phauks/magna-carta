import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import type { FirmDatabase } from "../src/firm-database/firm-database-object.ts";

/*
 * WHERE the pragma is executed decides whether it does anything.
 *
 * The earlier probe drove `PRAGMA foreign_keys=OFF` and the drop through separate RPC calls, and the
 * drop went through — which is what said the fix was sound. Production then failed at exactly that
 * drop, with the fix deployed. So the probe and the migration were not doing the same thing, and the
 * difference is the only thing left: a migration runs inside ONE durable-object execution context
 * (blockConcurrencyWhile, in the constructor), where storage may already be inside an implicit
 * transaction — and SQLite ignores this pragma inside a transaction while reporting success.
 *
 * This runs both shapes against the same real storage and states the difference outright, so the
 * answer is a property of the runtime rather than an inference about it.
 */
let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Pragma Context Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

function stub() {
  return env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName(firmId));
}

/** Parent, child, and one row each — the shape a rebuild has to survive. */
function seedProbe(sql: SqlStorage, suffix: string): void {
  sql.exec(`DROP TABLE IF EXISTS probe_child_${suffix}`);
  sql.exec(`DROP TABLE IF EXISTS probe_parent_${suffix}`);
  sql.exec(`CREATE TABLE probe_parent_${suffix} (id TEXT PRIMARY KEY, v TEXT)`);
  sql.exec(
    `CREATE TABLE probe_child_${suffix} (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES probe_parent_${suffix}(id))`,
  );
  sql.exec(`INSERT INTO probe_parent_${suffix} (id, v) VALUES ('p1', 'a')`);
  sql.exec(`INSERT INTO probe_child_${suffix} (id, parent_id) VALUES ('c1', 'p1')`);
}

type SqlStorage = { exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } };

describe("PRAGMA foreign_keys inside one durable-object execution context", () => {
  it("says whether the pragma suspends enforcement when both run in the SAME context", async () => {
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "same");
      try {
        // Exactly what applyMigration does: the pragma, then the drop, one context, no
        // transactionSync around the pragma itself.
        sql.exec("PRAGMA foreign_keys=OFF");
        sql.exec("DROP TABLE probe_parent_same");
        sql.exec("PRAGMA foreign_keys=ON");
        return "the pragma took effect";
      } catch (error) {
        try {
          sql.exec("PRAGMA foreign_keys=ON");
        } catch {
          // The restore is best effort; the outcome below is what this test is about.
        }
        return `the pragma did NOT take effect: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    // Asserted rather than logged, so the runtime's answer reaches the run report either way: a
    // pass is the pragma working, and a failure prints what it did instead.
    expect(outcome).toBe("the pragma took effect");
  });

  it("says whether YIELDING between the pragma and the drop lets it take effect", async () => {
    const outcome = await runInDurableObject(stub(), async (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "yield");
      try {
        sql.exec("PRAGMA foreign_keys=OFF");
        // If the implicit transaction is what swallows the pragma, letting the context return to
        // the event loop should commit it and leave the connection setting standing.
        await new Promise((resolve) => setTimeout(resolve, 0));
        sql.exec("DROP TABLE probe_parent_yield");
        sql.exec("PRAGMA foreign_keys=ON");
        return "yielding worked";
      } catch (error) {
        try {
          sql.exec("PRAGMA foreign_keys=ON");
        } catch {
          // best effort
        }
        return `yielding did not help: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    expect(outcome).toBe("yielding worked");
  });

  it("says whether defer_foreign_keys carries a rebuild through one context", async () => {
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "defer");
      try {
        // Unlike foreign_keys, SQLite documents defer_foreign_keys as settable INSIDE a
        // transaction — which is the one thing the migration context is guaranteed to be in.
        sql.exec("PRAGMA defer_foreign_keys=ON");
        sql.exec("CREATE TABLE __new_probe_parent_defer (id TEXT PRIMARY KEY, v TEXT, w TEXT)");
        sql.exec("INSERT INTO __new_probe_parent_defer SELECT id, v, NULL FROM probe_parent_defer");
        sql.exec("DROP TABLE probe_parent_defer");
        sql.exec("ALTER TABLE __new_probe_parent_defer RENAME TO probe_parent_defer");
        return "defer_foreign_keys carried the rebuild";
      } catch (error) {
        return `defer_foreign_keys did not: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    expect(outcome).toBe("defer_foreign_keys carried the rebuild");
  });

  it("rebuilds by renaming the original ASIDE, so nothing is ever dropped out from under a child", async () => {
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "aside");
      try {
        // legacy_alter_table stops the rename from REWRITING the child's reference, so the child
        // keeps naming `probe_parent_aside` — which is recreated in the next statement. The table
        // finally dropped is the one nothing points at, so no child is ever orphaned, at a statement
        // or at the commit workerd checks.
        sql.exec("PRAGMA legacy_alter_table=ON");
        sql.exec("ALTER TABLE probe_parent_aside RENAME TO __old_probe_parent_aside");
        sql.exec("CREATE TABLE probe_parent_aside (id TEXT PRIMARY KEY, v TEXT, w TEXT)");
        sql.exec(
          "INSERT INTO probe_parent_aside (id, v, w) SELECT id, v, NULL FROM __old_probe_parent_aside",
        );
        sql.exec("DROP TABLE __old_probe_parent_aside");
        sql.exec("PRAGMA legacy_alter_table=OFF");
        const kids = sql
          .exec(
            "SELECT COUNT(*) AS n FROM probe_child_aside JOIN probe_parent_aside ON probe_parent_aside.id = probe_child_aside.parent_id",
          )
          .toArray() as { n: number }[];
        return `rename-aside worked, children still resolve: ${String(kids[0]?.n ?? -1)}`;
      } catch (error) {
        return `rename-aside failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    expect(outcome).toBe("rename-aside worked, children still resolve: 1");
  });

  it("says whether a pragma set in an EARLIER context still stands in a later one", async () => {
    // The one shape that has ever worked: the earlier probe drove the pragma and the drop through
    // separate RPC calls and the drop went through. If the connection setting survives the context
    // that set it, then a migration only has to run in a context AFTER the one that suspends
    // enforcement — which is a change to when the runner is called, not to what a migration says.
    const seeded = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "twostep");
      sql.exec("PRAGMA foreign_keys=OFF");
      return "seeded and suspended";
    });
    expect(seeded).toBe("seeded and suspended");

    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      try {
        sql.exec("DROP TABLE probe_parent_twostep");
        sql.exec("CREATE TABLE probe_parent_twostep (id TEXT PRIMARY KEY, v TEXT, w TEXT)");
        sql.exec("INSERT INTO probe_parent_twostep (id, v, w) VALUES ('p1', 'a', NULL)");
        return "a pragma from an earlier context still stands";
      } catch (error) {
        return `it does not stand: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        try {
          sql.exec("PRAGMA foreign_keys=ON");
        } catch {
          // best effort
        }
      }
    });
    expect(outcome).toBe("a pragma from an earlier context still stands");
  });

  it("REBUILDS under defer_foreign_keys with the original renamed aside", async () => {
    // The combination the two halves above each missed. Cloudflare's own guidance is that
    // `PRAGMA foreign_keys` cannot be changed inside a migration — every query runs in an implicit
    // transaction — and that `defer_foreign_keys` is the supported relaxation, holding violations
    // until the end of that transaction, by which point they must all be resolved.
    //
    // Deferral alone is not enough: dropping the parent records a violation per child row that
    // recreating the name does not retract. legacy_alter_table alone is not enough either: renaming
    // the parent aside orphans its children immediately. Together they should work — the rename
    // leaves children naming a table that the very next statement recreates, the table finally
    // dropped is the one nothing points at, and deferral carries the gap to the commit where every
    // reference resolves again.
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "both");
      try {
        sql.exec("PRAGMA defer_foreign_keys=ON");
        sql.exec("PRAGMA legacy_alter_table=ON");
        sql.exec("ALTER TABLE probe_parent_both RENAME TO __old_probe_parent_both");
        // The widened CHECK is the whole point of a rebuild, so the replacement carries one.
        sql.exec(
          "CREATE TABLE probe_parent_both (id TEXT PRIMARY KEY, v TEXT, CONSTRAINT ck CHECK(v IN ('a','b')))",
        );
        sql.exec("INSERT INTO probe_parent_both (id, v) SELECT id, v FROM __old_probe_parent_both");
        sql.exec("DROP TABLE __old_probe_parent_both");
        sql.exec("PRAGMA legacy_alter_table=OFF");
        const kids = sql
          .exec(
            "SELECT COUNT(*) AS n FROM probe_child_both JOIN probe_parent_both ON probe_parent_both.id = probe_child_both.parent_id",
          )
          .toArray() as { n: number }[];
        return `rebuilt, children still resolve: ${String(kids[0]?.n ?? -1)}`;
      } catch (error) {
        return `failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    expect(outcome).toBe("rebuilt, children still resolve: 1");
  });

  it("enforces foreign keys on a drop with no pragma at all, in the same context", async () => {
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "bare");
      try {
        sql.exec("DROP TABLE probe_parent_bare");
        return "the drop went through unguarded";
      } catch (error) {
        return `enforced: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    expect(outcome).toContain("enforced");
  });
});
