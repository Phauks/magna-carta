import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  guardedIncrementStatement,
  isNumberAllocationConflict,
  readCounterValue,
} from "../src/numbering/counter-statements.ts";

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// The node:sqlite adapter surfaces a constraint failure as a synchronous throw from run(), so a
// rejects-matcher would never see it.
async function captureError(act: () => Promise<unknown>): Promise<unknown> {
  try {
    await act();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the statement to fail on a constraint");
}

const MATTER_ID = "matter_one" as MatterId;
const OTHER_MATTER_ID = "matter_two" as MatterId;
const NOW = "2026-06-13T12:00:00.000Z";

// matter_number_allocation.matter_id is a foreign key, so a draw's allocation row needs its matter.
async function seedMatter(database: BatchDatabase, matterId: MatterId): Promise<void> {
  await database
    .prepare(
      "INSERT OR IGNORE INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind("user_attorney" as UserId, NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'prospective', ?2, ?3, ?3)",
    )
    .bind(matterId, "user_attorney" as UserId, NOW)
    .run();
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

  it("a counter value can be allocated once per scope, and twice in different scopes", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await seedMatter(database, OTHER_MATTER_ID);
    await allocateCounterValueStatement(database, "RENO", 1, MATTER_ID, NOW).run();
    // Same value, different scope — counters reset per scope, so this is not a collision.
    await allocateCounterValueStatement(database, "VEGAS", 1, OTHER_MATTER_ID, NOW).run();
    const conflict = await captureError(() =>
      allocateCounterValueStatement(database, "RENO", 1, OTHER_MATTER_ID, NOW).run(),
    );
    expect(isNumberAllocationConflict(conflict)).toBe(true);
  });

  it("isNumberAllocationConflict recognizes only the allocation constraint", () => {
    expect(
      isNumberAllocationConflict(
        new Error(
          "UNIQUE constraint failed: matter_number_allocation.scope_key, matter_number_allocation.drawn_value",
        ),
      ),
    ).toBe(true);
    expect(
      isNumberAllocationConflict(new Error("UNIQUE constraint failed: matter.matter_number")),
    ).toBe(false);
    expect(isNumberAllocationConflict("not an error")).toBe(false);
  });
});
