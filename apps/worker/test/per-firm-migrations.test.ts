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

it("applies 0016 and creates the time-tracking tables", async () => {
  const db = env.DB_FIRM_POOL_1;
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('time_entry','rate_card','rate','utbms_code','non_billable_category','narrative_template')",
    )
    .all<{ name: string }>();
  expect(tables.results.map((r) => r.name).sort()).toEqual([
    "narrative_template",
    "non_billable_category",
    "rate",
    "rate_card",
    "time_entry",
    "utbms_code",
  ]);
});

it("0016 enforces the time_entry status and source CHECK enums", async () => {
  const db = env.DB_FIRM_POOL_1;
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entry'")
    .all<{ sql: string }>();
  const sql = ddl.results[0]?.sql ?? "";
  expect(sql).toContain("'draft'");
  expect(sql).toContain("'submitted'");
  expect(sql).toContain("'approved'");
  expect(sql).toContain("'billed'");
  expect(sql).toContain("'void'");
  expect(sql).toContain("'timer'");
  expect(sql).toContain("'quick_add'");
  expect(sql).toContain("'offline_sync'");
});

it("0016 ties amount_minor to rate_e4 by a paired-null CHECK", async () => {
  const db = env.DB_FIRM_POOL_1;
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entry'")
    .all<{ sql: string }>();
  const sql = ddl.results[0]?.sql ?? "";
  // amount_minor is non-null exactly when rate_e4 is non-null (non-billable rows leave both null).
  expect(sql.replace(/\s+/g, " ")).toContain("(`amount_minor` IS NULL) = (`rate_e4` IS NULL)");
});

it("0016 creates the two partial unique indexes (one open rate row per scope; one live_run_id)", async () => {
  const db = env.DB_FIRM_POOL_1;
  const indexes = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('rate_open_row_unique_index','time_entry_live_run_id_unique_index')",
    )
    .all<{ name: string }>();
  expect(indexes.results.map((r) => r.name).sort()).toEqual([
    "rate_open_row_unique_index",
    "time_entry_live_run_id_unique_index",
  ]);
});

it("0016 adds the nullable matter.e_billing flag, defaulting off", async () => {
  const db = env.DB_FIRM_POOL_1;
  const columns = await db.prepare("PRAGMA table_info('matter')").all<{
    name: string;
    dflt_value: string | null;
    notnull: number;
  }>();
  const eBilling = columns.results.find((c) => c.name === "e_billing");
  expect(eBilling).toBeDefined();
  expect(eBilling?.notnull).toBe(1);
  expect(eBilling?.dflt_value).toBe("0");
});

it("0016 seeds the six time: permissions onto the Owner/Admin role", async () => {
  const db = env.DB_FIRM_POOL_1;
  const seeded = await db
    .prepare("SELECT permission FROM role_permission WHERE permission LIKE 'time:%'")
    .all<{ permission: string }>();
  expect(seeded.results.map((r) => r.permission).sort()).toEqual([
    "time:approve",
    "time:manageRates",
    "time:manageSettings",
    "time:manageUtbms",
    "time:track",
    "time:viewFirm",
  ]);
});

it("0016 adds the nullable kick_back_reason column to time_entry", async () => {
  const db = env.DB_FIRM_POOL_1;
  const columns = await db.prepare("PRAGMA table_info('time_entry')").all<{
    name: string;
    notnull: number;
  }>();
  const col = columns.results.find((c) => c.name === "kick_back_reason");
  expect(col).toBeDefined();
  expect(col?.notnull).toBe(0); // nullable
});

it("0016 creates the scoped_setting table with the (key, scope_tier, scoped_id) primary key", async () => {
  const db = env.DB_FIRM_POOL_1;
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scoped_setting'")
    .all<{ sql: string }>();
  const sql = (ddl.results[0]?.sql ?? "").replace(/\s+/g, " ");
  expect(sql).toContain("scoped_setting");
  expect(sql).toContain("'matter'");
  expect(sql).toContain("'client'");
  expect(sql).toContain("'user'");
  expect(sql).toContain("'location'");
  expect(sql).toContain("'firm'");
  expect(sql).toContain("PRIMARY KEY(`key`, `scope_tier`, `scoped_id`)");
});
