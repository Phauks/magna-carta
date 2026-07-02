import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { describe, expect, it } from "vitest";
import {
  ensureCounterRowStatement,
  guardedIncrementStatement,
  readCounterValue,
} from "../src/numbering/counter-statements.ts";

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

describe("matter-number counter statements", () => {
  it("ensure-row inserts at the start value when absent and never overwrites an existing row", async () => {
    const database = freshDatabase();
    await ensureCounterRowStatement(database, "RENO:26", 100).run();
    expect(await readCounterValue(database, "RENO:26")).toBe(100);
    // A second ensure with a different start must NOT clobber the existing counter.
    await ensureCounterRowStatement(database, "RENO:26", 1).run();
    expect(await readCounterValue(database, "RENO:26")).toBe(100);
  });

  it("readCounterValue returns undefined for an absent scope", async () => {
    const database = freshDatabase();
    expect(await readCounterValue(database, "")).toBeUndefined();
  });

  it("guarded increment advances only when the observed value still matches", async () => {
    const database = freshDatabase();
    await ensureCounterRowStatement(database, "", 1).run();
    const advanced = await guardedIncrementStatement(database, "", 1).run();
    expect(advanced.meta.changes).toBe(1);
    expect(await readCounterValue(database, "")).toBe(2);
    // A stale observed value matches no row — a no-op (the losing concurrent draw).
    const stale = await guardedIncrementStatement(database, "", 1).run();
    expect(stale.meta.changes).toBe(0);
    expect(await readCounterValue(database, "")).toBe(2);
  });
});
