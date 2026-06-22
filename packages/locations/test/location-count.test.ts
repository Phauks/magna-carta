import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";
import { readLocationCount } from "../src/statements.ts";

function freshDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}

describe("readLocationCount", () => {
  it("is zero on an empty firm", async () => {
    expect(await readLocationCount(freshDatabase())).toBe(0);
  });

  it("counts every location regardless of status", async () => {
    const database = freshDatabase();
    const t = "2026-01-01T00:00:00.000Z";
    await database
      .prepare(
        "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_a','A','active',NULL,NULL,NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_b','B','closed',NULL,NULL,NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    expect(await readLocationCount(database)).toBe(2);
  });
});
