import { env } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  firmDatabaseFor,
  type ProxyBatchDatabase,
} from "../src/firm-database/firm-database-proxy.ts";

// Migration fitness test: a freshly migrated per-firm database carries the expected tables and
// structural invariants. Each `it` that exercises a migration milestone is independent — all tests
// share one migrated database (applied once in beforeAll) and assert against sqlite_master.

let testDatabase: ProxyBatchDatabase;

beforeAll(async () => {
  // The DO self-migrates the per-firm schema on first access — no explicit migration call needed.
  testDatabase = firmDatabaseFor(env.FIRM_DATABASE, newIdentifier("firm"));
});

it("applies 0012 and creates the custom-fields tables", async () => {
  const tables = await testDatabase
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_field','picklist_option','custom_field_value')",
    )
    .all<{ name: string }>();
  expect(tables.results.map((r) => r.name).sort()).toEqual([
    "custom_field",
    "custom_field_value",
    "picklist_option",
  ]);
  const idx = await testDatabase
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='custom_field_value_current_unique_index'",
    )
    .all();
  expect(idx.results.length).toBe(1);
});
