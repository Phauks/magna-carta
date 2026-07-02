import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  createMatterType,
  deactivateMatterType,
  updateMatterType,
} from "../src/matter-type-service.ts";

const clock = { now: () => "2026-06-13T12:00:00.000Z" };
const now = () => clock.now();
const options = { clock, actorUserId: "user_admin" as UserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function readType(database: BatchDatabase, id: MatterTypeId) {
  const { results } = await database
    .prepare("SELECT name, code, active FROM matter_type WHERE id = ?1")
    .bind(id)
    .all<{ name: string; code: string | null; active: number }>();
  return results[0];
}

describe("createMatterType", () => {
  it("creates an active type with a name and code", async () => {
    const database = freshDatabase();
    const { matterTypeId, effect } = await createMatterType(
      database,
      { name: "Personal Injury", code: "PI" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    expect(await readType(database, matterTypeId)).toEqual({
      name: "Personal Injury",
      code: "PI",
      active: 1,
    });
  });

  it("refuses an empty name", async () => {
    const database = freshDatabase();
    await expect(createMatterType(database, { name: "  " }, options)).rejects.toMatchObject({
      code: "empty-type-name",
    });
  });

  it("refuses a duplicate name and a duplicate code", async () => {
    const database = freshDatabase();
    const first = await createMatterType(
      database,
      { name: "Personal Injury", code: "PI" },
      options,
    );
    await commitEffectBatch(database, first.effect, { now });
    await expect(
      createMatterType(database, { name: "Personal Injury", code: "PX" }, options),
    ).rejects.toMatchObject({ code: "type-name-taken" });
    await expect(
      createMatterType(database, { name: "Product Injury", code: "PI" }, options),
    ).rejects.toMatchObject({ code: "type-code-taken" });
  });
});

describe("updateMatterType", () => {
  it("renames a type (renaming to its own name is allowed)", async () => {
    const database = freshDatabase();
    const { matterTypeId, effect } = await createMatterType(
      database,
      { name: "PI", code: "PI" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const updated = await updateMatterType(
      database,
      matterTypeId,
      { name: "Personal Injury" },
      options,
    );
    await commitEffectBatch(database, updated.effect, { now });
    expect((await readType(database, matterTypeId))?.name).toBe("Personal Injury");
    // Re-saving the same name (a no-op rename) must not trip the uniqueness check against itself.
    const same = await updateMatterType(
      database,
      matterTypeId,
      { name: "Personal Injury" },
      options,
    );
    await commitEffectBatch(database, same.effect, { now });
    expect((await readType(database, matterTypeId))?.name).toBe("Personal Injury");
  });

  it("refuses an unknown type", async () => {
    const database = freshDatabase();
    await expect(
      updateMatterType(database, "matterType_missing" as MatterTypeId, { name: "X" }, options),
    ).rejects.toMatchObject({ code: "unknown-matter-type" });
  });

  it("refuses renaming onto another type's name", async () => {
    const database = freshDatabase();
    const a = await createMatterType(database, { name: "PI", code: "PI" }, options);
    await commitEffectBatch(database, a.effect, { now });
    const b = await createMatterType(database, { name: "Family", code: "FA" }, options);
    await commitEffectBatch(database, b.effect, { now });
    await expect(
      updateMatterType(database, b.matterTypeId, { name: "PI" }, options),
    ).rejects.toMatchObject({ code: "type-name-taken" });
  });
});

describe("deactivateMatterType", () => {
  it("soft-deactivates a type", async () => {
    const database = freshDatabase();
    const { matterTypeId, effect } = await createMatterType(database, { name: "PI" }, options);
    await commitEffectBatch(database, effect, { now });
    const deactivated = await deactivateMatterType(database, matterTypeId, options);
    await commitEffectBatch(database, deactivated.effect, { now });
    expect((await readType(database, matterTypeId))?.active).toBe(0);
  });

  it("refuses an unknown type", async () => {
    const database = freshDatabase();
    await expect(
      deactivateMatterType(database, "matterType_missing" as MatterTypeId, options),
    ).rejects.toMatchObject({ code: "unknown-matter-type" });
  });
});
