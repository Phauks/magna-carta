import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { seedFirm } from "./support/test-auth.ts";

/*
 * WHETHER THE PRAGMA ACTUALLY WORKS HERE.
 *
 * A table rebuild drops the old table, and DROP TABLE on a parent with foreign keys enforced fires a
 * violation for every child row. The rebuild migrations handle that by turning enforcement off — and
 * the whole question is whether that instruction does anything on this runtime.
 *
 * It is worth asking out loud because two answers already turned out to be wrong. Written inside the
 * migration, the pragma is a no-op: SQLite honours it only outside a transaction, and the runner
 * executes migration text inside one. Moving it outside the transaction fixes that on node:sqlite —
 * but node:sqlite is not what production runs, and a fix verified only there is a guess about
 * workerd. Cloudflare's SQLite is free to refuse a pragma, or accept it and ignore it, and either
 * would look exactly like success from the caller's side.
 *
 * So this asks the runtime directly, against real durable-object storage, with a child row present:
 * enforcement on, prove it bites; enforcement off, prove the drop goes through; enforcement back on,
 * prove it bites again. Applying a migration chain to an empty database cannot answer any of it —
 * a database with no rows has no children to orphan, which is how this got to production twice.
 */
let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (
    await seedFirm({ name: "Foreign Key Pragma Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

function database() {
  return firmDatabaseFor(env.FIRM_DATABASE, firmId);
}

async function run(sql: string): Promise<void> {
  await database().prepare(sql).bind().run();
}

describe("durable-object SQLite: foreign key enforcement and the pragma that suspends it", () => {
  beforeAll(async () => {
    await run("DROP TABLE IF EXISTS fk_probe_child");
    await run("DROP TABLE IF EXISTS fk_probe_parent");
    await run("CREATE TABLE fk_probe_parent (id TEXT PRIMARY KEY, v TEXT)");
    await run(
      "CREATE TABLE fk_probe_child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES fk_probe_parent(id))",
    );
    await run("INSERT INTO fk_probe_parent (id, v) VALUES ('p1', 'a')");
    await run("INSERT INTO fk_probe_child (id, parent_id) VALUES ('c1', 'p1')");
  });

  it("enforces foreign keys by default, which is why a rebuild has to say anything at all", async () => {
    await expect(
      run("INSERT INTO fk_probe_child (id, parent_id) VALUES ('c2', 'nobody')"),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/u);
  });

  it("refuses to drop a parent that still has children while enforcement is on", async () => {
    // The production failure, reproduced on the runtime that produced it.
    await expect(run("DROP TABLE fk_probe_parent")).rejects.toThrow(
      /FOREIGN KEY constraint failed/u,
    );
  });

  it("HONOURS the pragma outside a transaction: the same drop then goes through", async () => {
    await run("PRAGMA foreign_keys=OFF");
    await run("DROP TABLE fk_probe_parent");
    await run("CREATE TABLE fk_probe_parent (id TEXT PRIMARY KEY, v TEXT, w TEXT)");
    await run("INSERT INTO fk_probe_parent (id, v, w) VALUES ('p1', 'a', 'b')");
    await run("PRAGMA foreign_keys=ON");

    // Nothing dangling: the child still resolves to the row it resolved to before.
    const orphans = await database().prepare("PRAGMA foreign_key_check").bind().all();
    expect(orphans.results).toEqual([]);
  });

  it("restores enforcement afterwards, so the suspension does not outlive the migration", async () => {
    await expect(
      run("INSERT INTO fk_probe_child (id, parent_id) VALUES ('c3', 'nobody')"),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/u);
  });
});
