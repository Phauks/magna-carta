import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";
import { readMatterCounts } from "../src/queries.ts";

const MEMBER_ID = "user_member_test";

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMember(database: ReturnType<typeof freshDatabase>): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'M', 'active', '2026-01-01T00:00:00.000Z')",
    )
    .bind(MEMBER_ID)
    .run();
}

async function insertMatter(database: ReturnType<typeof freshDatabase>, id: string, status: string) {
  const t = "2026-01-01T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1,'T',NULL,?2,NULL,NULL,?3,NULL,NULL,NULL,NULL,NULL,NULL,?4,?4)",
    )
    .bind(id, status, MEMBER_ID, t)
    .run();
}

describe("readMatterCounts", () => {
  it("is all zeros on an empty firm", async () => {
    expect(await readMatterCounts(freshDatabase())).toEqual({
      total: 0,
      prospective: 0,
      open: 0,
      closed: 0,
    });
  });

  it("counts by status and totals them", async () => {
    const database = freshDatabase();
    await seedMember(database);
    await insertMatter(database, "m1", "prospective");
    await insertMatter(database, "m2", "open");
    await insertMatter(database, "m3", "open");
    await insertMatter(database, "m4", "closed");
    expect(await readMatterCounts(database)).toEqual({
      total: 4,
      prospective: 1,
      open: 2,
      closed: 1,
    });
  });
});
