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
    expect(outcome).toContain("the pragma did NOT take effect");
    expect(outcome).toContain("FOREIGN KEY constraint failed");
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
    expect(outcome).toContain("yielding did not help");
  });

  it("says whether defer_foreign_keys carries a rebuild through one context", async () => {
    const attempt = runInDurableObject(stub(), (instance: FirmDatabase) => {
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
    // Deferral does exactly what it says — no statement refuses — so the failure arrives at the
    // COMMIT, as a durable-object reset rather than a value this callback could return. Caught
    // here so the run report says which of the two happened.
    const outcome = await attempt.then(
      (value) => value,
      (error: unknown) =>
        `the commit rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
    expect(outcome).toMatch(/^(defer_foreign_keys did not|the commit rejected):/u);
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
    expect(outcome).toContain("rename-aside failed");
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
    expect(outcome).toContain("it does not stand");
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
    const attempt = runInDurableObject(stub(), (instance: FirmDatabase) => {
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
    // The rejection is caught rather than asserted with `.rejects`, because WHERE it fails is part
    // of the finding and only the message says which: a statement that refuses outright surfaces
    // through the `catch` above as "failed: ...", while a deferred violation lets every statement
    // succeed and rejects at the COMMIT, which reaches here as a thrown reset instead.
    const outcome = await attempt.then(
      (value) => value,
      (error: unknown) =>
        `commit rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Deferral genuinely defers, and the deferred violation is still outstanding at the commit — so
    // the combination that should have worked does not, and the rebuild never lands.
    expect(outcome).toMatch(/^(failed|commit rejected):/u);
  });

  it("says whether writable_schema can widen a CHECK with nothing dropped at all", async () => {
    /*
     * The one mechanism the five probes above do not cover, and the only one that does not need a
     * drop. SQLite documents editing `sqlite_schema` under `PRAGMA writable_schema` as the way to
     * change a table's constraints in place: the table keeps its identity, its rowids and its
     * children, and no DROP is ever issued — so the foreign-key enforcement that defeats every
     * rebuild above has nothing to fire on.
     *
     * If it works here, widening a CHECK on a PARENT table stops being an open question for this
     * fleet. If it does not, expand-contract is the only route left and this test is the record of
     * why.
     */
    const attempt = runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      sql.exec("DROP TABLE IF EXISTS probe_child_writable");
      sql.exec("DROP TABLE IF EXISTS probe_parent_writable");
      sql.exec(
        "CREATE TABLE probe_parent_writable (id TEXT PRIMARY KEY, v TEXT, CONSTRAINT ck CHECK(v IN ('a','b')))",
      );
      sql.exec(
        "CREATE TABLE probe_child_writable (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES probe_parent_writable(id))",
      );
      sql.exec("INSERT INTO probe_parent_writable (id, v) VALUES ('p1', 'a')");
      sql.exec("INSERT INTO probe_child_writable (id, parent_id) VALUES ('c1', 'p1')");
      try {
        sql.exec("PRAGMA writable_schema=ON");
        sql.exec(
          `UPDATE sqlite_schema SET sql = 'CREATE TABLE probe_parent_writable (id TEXT PRIMARY KEY, v TEXT, CONSTRAINT ck CHECK(v IN (''a'',''b'',''c'')))' WHERE type = 'table' AND name = 'probe_parent_writable'`,
        );
        sql.exec("PRAGMA writable_schema=RESET");
        // The widened value is the whole question: it was refused a moment ago.
        sql.exec("INSERT INTO probe_parent_writable (id, v) VALUES ('p2', 'c')");
        const kids = sql
          .exec(
            "SELECT COUNT(*) AS n FROM probe_child_writable JOIN probe_parent_writable ON probe_parent_writable.id = probe_child_writable.parent_id",
          )
          .toArray() as { n: number }[];
        return `writable_schema widened the CHECK, children still resolve: ${String(kids[0]?.n ?? -1)}`;
      } catch (error) {
        return `writable_schema did not: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        try {
          sql.exec("PRAGMA writable_schema=OFF");
        } catch {
          // best effort
        }
      }
    });
    const outcome = await attempt.then(
      (value) => value,
      (error: unknown) =>
        `the commit rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
    // workerd's authorizer refuses the pragma outright, so the schema is never writable and the
    // widened value is never reached. That is the sixth and last mechanism: there is no way to
    // change a CHECK on a parent table in this runtime, and the answer is to add a column instead.
    expect(outcome).toContain("writable_schema did not");
    expect(outcome).toContain("SQLITE_AUTH");
  });

  it("adds a column WITH a CHECK to a parent table, which is the route that is left", async () => {
    /*
     * The counterpart to every refusal above: ALTER TABLE ADD COLUMN drops nothing, so it fires no
     * foreign-key violation and needs no pragma. The question this settles is narrower and it is
     * the one the expand phase rests on — whether the ADDED column may carry its own CHECK, and
     * whether that CHECK may name another column, since a pair of columns that must be null or
     * non-null together is the ordinary shape of an added fact.
     */
    const outcome = await runInDurableObject(stub(), (instance: FirmDatabase) => {
      const sql = (instance as unknown as { ctx: { storage: { sql: SqlStorage } } }).ctx.storage
        .sql;
      seedProbe(sql, "addcolumn");
      try {
        sql.exec(
          "ALTER TABLE probe_parent_addcolumn ADD COLUMN rung TEXT NOT NULL DEFAULT 'to_do' CHECK (rung IN ('to_do', 'in_progress', 'on_hold'))",
        );
        sql.exec("ALTER TABLE probe_parent_addcolumn ADD COLUMN archived_at TEXT");
        sql.exec(
          "ALTER TABLE probe_parent_addcolumn ADD COLUMN archived_by TEXT CHECK ((archived_at IS NULL) = (archived_by IS NULL))",
        );
        const seededRung = sql
          .exec("SELECT rung FROM probe_parent_addcolumn WHERE id = 'p1'")
          .toArray() as { rung: string }[];
        sql.exec("UPDATE probe_parent_addcolumn SET rung = 'on_hold' WHERE id = 'p1'");
        let refusedBadValue = false;
        try {
          sql.exec("UPDATE probe_parent_addcolumn SET rung = 'nonsense' WHERE id = 'p1'");
        } catch {
          refusedBadValue = true;
        }
        let refusedHalfPair = false;
        try {
          sql.exec("UPDATE probe_parent_addcolumn SET archived_at = '2026-09-14' WHERE id = 'p1'");
        } catch {
          refusedHalfPair = true;
        }
        return `added: existing row defaulted to ${seededRung[0]?.rung ?? "?"}, bad value refused ${String(refusedBadValue)}, half a pair refused ${String(refusedHalfPair)}`;
      } catch (error) {
        return `ADD COLUMN failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    // Every part of the expand phase, proved against real durable-object storage rather than
    // assumed: the column lands on a parent with a child, existing rows take the default, the
    // CHECK is enforced, and a CHECK naming a second column is enforced too.
    expect(outcome).toBe(
      "added: existing row defaulted to to_do, bad value refused true, half a pair refused true",
    );
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
