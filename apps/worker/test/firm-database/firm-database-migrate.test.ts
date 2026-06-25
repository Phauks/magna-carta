import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { FirmDatabase } from "../../src/firm-database/firm-database-object.ts";
import { perFirmMigrations } from "../../src/per-firm-migrations.ts";

describe("FirmDatabase", () => {
  it("self-migrates the full per-firm lineage on wake", async () => {
    const stub = env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName("firm_x"));
    const tables = await runInDurableObject(stub, (instance: FirmDatabase) =>
      instance.tableCountForTest(),
    );
    expect(tables).toBeGreaterThan(10);

    // Every migration tag must be recorded, so a partial lineage (some tables present, later
    // migrations skipped) is caught rather than passing the table-count floor by accident.
    const appliedTags = await runInDurableObject(stub, (instance: FirmDatabase) =>
      instance.appliedMigrationTagsForTest(),
    );
    const expectedTags = perFirmMigrations()
      .map((migration) => migration.tag)
      .sort();
    expect(appliedTags).toEqual(expectedTags);
  });
});
