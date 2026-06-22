import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  NON_BILLABLE_CATEGORY_DEFAULTS,
  seedNonBillableCategoryStatements,
} from "../src/non-billable-category-statements.ts";
import {
  archiveNonBillableCategory,
  createNonBillableCategory,
  updateNonBillableCategory,
} from "../src/non-billable-category-service.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const ADMIN = "user_admin" as UserId;
const options = { clock, actorUserId: ADMIN };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function listCategories(database: BatchDatabase) {
  const { results } = await database
    .prepare("SELECT id, name, archived_at FROM non_billable_category ORDER BY name")
    .all<{ id: string; name: string; archived_at: string | null }>();
  return results;
}

describe("non-billable category seed-and-fork", () => {
  it("seeds the four default categories", async () => {
    const database = freshDatabase();
    await database.batch(seedNonBillableCategoryStatements(database, clock.now()));
    const names = (await listCategories(database)).map((row) => row.name);
    expect(names).toEqual([...NON_BILLABLE_CATEGORY_DEFAULTS].sort());
    expect(names).toContain("Administrative");
    expect(names).toContain("Business Development");
    expect(names).toContain("Pro Bono");
    expect(names).toContain("Training/CLE");
  });
});

describe("non-billable category CRUD", () => {
  it("creates, renames, and soft-archives (never hard delete), auditing each", async () => {
    const database = freshDatabase();
    const created = await createNonBillableCategory(database, { name: "Knowledge Management" }, options);
    await commitEffectBatch(database, created.effect, { now: clock.now });
    expect((await listCategories(database))[0]).toMatchObject({ name: "Knowledge Management", archived_at: null });

    const renamed = await updateNonBillableCategory(
      database,
      created.nonBillableCategoryId,
      { name: "Knowledge Mgmt" },
      options,
    );
    await commitEffectBatch(database, renamed.effect, { now: clock.now });
    expect((await listCategories(database))[0]?.name).toBe("Knowledge Mgmt");

    const archived = await archiveNonBillableCategory(database, created.nonBillableCategoryId, options);
    await commitEffectBatch(database, archived.effect, { now: clock.now });
    const row = (await listCategories(database))[0];
    expect(row?.archived_at).not.toBeNull(); // soft-archive: the row survives
    expect(row?.name).toBe("Knowledge Mgmt");

    const { results: audits } = await database
      .prepare("SELECT event FROM audit_log ORDER BY created_at")
      .all<{ event: string }>();
    expect(audits.map((a) => a.event)).toEqual([
      "non_billable_category.created",
      "non_billable_category.updated",
      "non_billable_category.archived",
    ]);
  });

  it("refuses an empty category name", async () => {
    const database = freshDatabase();
    await expect(
      createNonBillableCategory(database, { name: "  " }, options),
    ).rejects.toMatchObject({ code: "empty-name" });
  });

  it("updateNonBillableCategory throws not-found for an unknown id and writes no audit row", async () => {
    const database = freshDatabase();
    const bogusId = "nonBillableCategory_not_real" as never;
    let thrown: unknown;
    try {
      await updateNonBillableCategory(database, bogusId, { name: "Whatever" }, options);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimeEntryValidationError);
    expect((thrown as TimeEntryValidationError).code).toBe("not-found");
    // No phantom audit row must land for a subject that never existed.
    const { results: audits } = await database
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id = ?1")
      .bind(bogusId)
      .all<{ n: number }>();
    expect(audits[0]?.n).toBe(0);
  });

  it("archiveNonBillableCategory throws not-found for an unknown id and writes no audit row", async () => {
    const database = freshDatabase();
    const bogusId = "nonBillableCategory_not_real" as never;
    let thrown: unknown;
    try {
      await archiveNonBillableCategory(database, bogusId, options);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimeEntryValidationError);
    expect((thrown as TimeEntryValidationError).code).toBe("not-found");
    const { results: audits } = await database
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id = ?1")
      .bind(bogusId)
      .all<{ n: number }>();
    expect(audits[0]?.n).toBe(0);
  });
});
