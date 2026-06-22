import { env } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";

// Migration fitness test: a freshly migrated per-firm database carries the expected tables and
// structural invariants. Each `it` that exercises a migration milestone is independent — all tests
// share one migrated database (applied once in beforeAll) and assert against sqlite_master.

beforeAll(async () => {
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

it("applies 0012 and creates the custom-fields tables", async () => {
  const db = env.DB_FIRM_POOL_1;
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_field','picklist_option','custom_field_value')",
    )
    .all<{ name: string }>();
  expect(tables.results.map((r) => r.name).sort()).toEqual([
    "custom_field",
    "custom_field_value",
    "picklist_option",
  ]);
  const idx = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='custom_field_value_current_unique_index'",
    )
    .all();
  expect(idx.results.length).toBe(1);
});
