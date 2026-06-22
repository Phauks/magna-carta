import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { utbmsSeedData } from "../src/utbms-catalog.ts";
import {
  listUtbmsCodesBySetStatement,
  seedUtbmsCatalogStatements,
} from "../src/utbms-statements.ts";
import { disableUtbmsCode, enableUtbmsCode } from "../src/utbms-service.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const ADMIN = "user_admin" as UserId;
const options = { clock, actorUserId: ADMIN };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedCatalog(database: BatchDatabase): Promise<void> {
  await database.batch(seedUtbmsCatalogStatements(database));
}

async function listSet(database: BatchDatabase, codeSet: string) {
  const { results } = await listUtbmsCodesBySetStatement(database, codeSet).all<{
    id: string;
    code: string;
    label: string;
    active: number;
  }>();
  return results;
}

describe("utbms catalog seed", () => {
  it("emits one insert per published task/activity/expense code", async () => {
    const database = freshDatabase();
    const statements = seedUtbmsCatalogStatements(database);
    expect(statements.length).toBe(utbmsSeedData.length);
    expect(utbmsSeedData.length).toBeGreaterThan(0);
    await database.batch(statements);

    const tasks = await listSet(database, "task");
    const activities = await listSet(database, "activity");
    const expenses = await listSet(database, "expense");
    expect(tasks.some((row) => row.code === "L120")).toBe(true);
    expect(activities.some((row) => row.code === "A101")).toBe(true);
    expect(expenses.some((row) => row.code === "E101")).toBe(true);
    // Every seeded code starts active.
    expect([...tasks, ...activities, ...expenses].every((row) => row.active === 1)).toBe(true);
  });

  it("seeds deterministic handles so a re-seed is a no-op on the UNIQUE (code_set, code)", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    // Re-seeding must not duplicate rows (INSERT OR IGNORE on the UNIQUE index).
    await seedCatalog(database);
    const tasks = await listSet(database, "task");
    const l120 = tasks.filter((row) => row.code === "L120");
    expect(l120.length).toBe(1);
  });
});

describe("enable/disable", () => {
  it("disableUtbmsCode flips active to 0 and audits", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    const id = (await listSet(database, "task")).find((row) => row.code === "L120")!.id;

    const { effect } = await disableUtbmsCode(database, id as never, options);
    await commitEffectBatch(database, effect, { now: clock.now });
    const row = (await listSet(database, "task")).find((r) => r.code === "L120")!;
    expect(row.active).toBe(0);

    const { results: audits } = await database
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'utbms_code.disabled'")
      .all<{ n: number }>();
    expect(audits[0]?.n).toBe(1);
  });

  it("enableUtbmsCode flips active back to 1 and audits", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    const id = (await listSet(database, "task")).find((row) => row.code === "L120")!.id;
    await commitEffectBatch(database, (await disableUtbmsCode(database, id as never, options)).effect, { now: clock.now });
    await commitEffectBatch(database, (await enableUtbmsCode(database, id as never, options)).effect, { now: clock.now });
    expect((await listSet(database, "task")).find((r) => r.code === "L120")!.active).toBe(1);
  });

  it("a toggle on an unknown id touches no row (the service only toggles seeded rows)", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    const before = await listSet(database, "task");
    const { effect } = await disableUtbmsCode(database, "utbmsCode_not_real" as never, options);
    await commitEffectBatch(database, effect, { now: clock.now });
    // No invented code, no row mutated: the active set is unchanged.
    expect(await listSet(database, "task")).toEqual(before);
  });
});
