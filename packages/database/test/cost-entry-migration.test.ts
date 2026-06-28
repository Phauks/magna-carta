import { test, expect } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";

// Helper: seed a member + matter pair to satisfy the cost_entry FK chain.
// The member row must exist before matter (responsible_member_id FK).
function seedMatterFixture(raw: import("node:sqlite").DatabaseSync, suffix: string) {
  const userId = `user_${suffix}`;
  const matterId = `matter_${suffix}`;
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES (?, 'Test User', 'active', 0, '2026-01-01T00:00:00.000Z')`,
    )
    .run(userId);
  raw
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?, 'Test Matter', 'open', ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(matterId, userId);
  return { userId, matterId };
}

test("cost_entry migration creates the table with all expected columns", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("cost_entry");

  // Verify column structure via pragma
  const columns = raw.prepare("PRAGMA table_info(cost_entry)").all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];
  const colNames = columns.map((c) => c.name);
  for (const expected of [
    "id",
    "matter_id",
    "vendor_id",
    "incurred_date",
    "amount_minor",
    "currency",
    "disbursement_class",
    "billable",
    "utbms_expense_code_id",
    "description",
    "receipt_file_id",
    "status",
    "kick_back_reason",
    "source",
    "recovery_category",
    "recovery_ref",
    "invoice_id",
    "created_at",
    "updated_at",
    "created_by",
  ]) {
    expect(colNames, `column ${expected} should exist`).toContain(expected);
  }

  // description has a default of ''
  const descCol = columns.find((c) => c.name === "description");
  expect(descCol?.dflt_value).toBe("''");
});

test("cost_entry CHECK rejects an invalid disbursement_class", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const { matterId } = seedMatterFixture(raw, "tst01aaaaaaaaaaaaa");

  // Valid insert — disbursement_class = 'hard'
  expect(() => {
    raw
      .prepare(
        `INSERT INTO cost_entry
           (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
         VALUES
           (?, ?, '2026-01-01', 100, 'USD', 'hard', 1, 'Filing fee', 'draft', 'manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run("costEntry_valid0aaaaaaaaaaaaa", matterId);
  }).not.toThrow();

  // Invalid disbursement_class — the CHECK must reject it
  expect(() => {
    raw
      .prepare(
        `INSERT INTO cost_entry
           (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
         VALUES
           (?, ?, '2026-01-01', 100, 'USD', 'overhead', 1, 'Bad class', 'draft', 'manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run("costEntry_bad01aaaaaaaaaaaaa", matterId);
  }).toThrow();
});

test("cost_entry CHECK rejects an invalid status", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const { matterId } = seedMatterFixture(raw, "tst02aaaaaaaaaaaaa");

  expect(() => {
    raw
      .prepare(
        `INSERT INTO cost_entry
           (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, created_at, updated_at)
         VALUES
           (?, ?, '2026-01-01', 100, 'USD', 'soft', 1, 'Bad status', 'pending', 'manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run("costEntry_bad02aaaaaaaaaaaaa", matterId);
  }).toThrow();
});

test("cost_entry partial unique on recovery_ref allows two NULLs but rejects two equal non-NULLs", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const { matterId } = seedMatterFixture(raw, "tst03aaaaaaaaaaaaa");

  // Two rows with NULL recovery_ref — both must succeed (SQLite treats NULLs as distinct)
  raw
    .prepare(
      `INSERT INTO cost_entry
         (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, recovery_ref, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', 50, 'USD', 'soft', 0, 'Null ref 1', 'draft', 'manual', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run("costEntry_null1aaaaaaaaaaaaa", matterId);

  expect(() => {
    raw
      .prepare(
        `INSERT INTO cost_entry
           (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, recovery_ref, created_at, updated_at)
         VALUES (?, ?, '2026-01-01', 50, 'USD', 'soft', 0, 'Null ref 2', 'draft', 'manual', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run("costEntry_null2aaaaaaaaaaaaa", matterId);
  }).not.toThrow();

  // First non-NULL recovery_ref — must succeed
  raw
    .prepare(
      `INSERT INTO cost_entry
         (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, recovery_ref, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', 75, 'USD', 'hard', 1, 'Recovery 1', 'draft', 'recovery', 'ship_ABC123', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run("costEntry_ref01aaaaaaaaaaaaa", matterId);

  // Duplicate non-NULL recovery_ref — the partial unique index must reject it
  expect(() => {
    raw
      .prepare(
        `INSERT INTO cost_entry
           (id, matter_id, incurred_date, amount_minor, currency, disbursement_class, billable, description, status, source, recovery_ref, created_at, updated_at)
         VALUES (?, ?, '2026-01-01', 75, 'USD', 'hard', 1, 'Recovery 2', 'draft', 'recovery', 'ship_ABC123', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run("costEntry_ref02aaaaaaaaaaaaa", matterId);
  }).toThrow();
});
