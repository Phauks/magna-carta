import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CostEntryId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  attachReceiptStatement,
  type CostDraftPatch,
  detachReceiptStatement,
  type InsertCostEntryRow,
  insertCostEntryStatement,
  selectCostEntryStatement,
  selectMatterEBillingStatement,
  setCostKickBackReasonStatement,
  transitionCostStatusStatement,
  updateDraftCostStatement,
} from "../src/cost-entry-statements.ts";

const clock = { now: () => "2026-06-25T10:00:00.000Z" };
const ACTOR = "user_attorney";
const MATTER_ID = "matter_1" as MatterId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMatter(database: BatchDatabase, matterId: string, eBilling = 0): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(ACTOR, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, ?3, ?4, ?4)",
    )
    .bind(matterId, ACTOR, eBilling, clock.now())
    .run();
}

const BASE_ROW: InsertCostEntryRow = {
  id: "cost_1" as CostEntryId,
  matterId: MATTER_ID,
  vendorId: null,
  incurredDate: "2026-06-25",
  amountMinor: 5000,
  currency: "USD",
  disbursementClass: "hard",
  billable: 1,
  utbmsExpenseCodeId: null,
  description: "Filing fee",
  receiptFileId: null,
  source: "manual",
  recoveryCategory: null,
  recoveryRef: null,
  createdAt: clock.now(),
  createdBy: ACTOR,
};

async function readRow(
  database: BatchDatabase,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const { results } = await database
    .prepare(
      "SELECT id, matter_id, vendor_id, incurred_date, amount_minor, currency, disbursement_class, billable, utbms_expense_code_id, description, receipt_file_id, status, kick_back_reason, source, recovery_category, recovery_ref, invoice_id, created_at, updated_at, created_by FROM cost_entry WHERE id = ?1",
    )
    .bind(id)
    .all();
  return results[0] as Record<string, unknown> | undefined;
}

describe("insertCostEntryStatement", () => {
  it("writes a draft row with all columns including disbursement_class", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const row = await readRow(database, "cost_1");
    expect(row).toMatchObject({
      id: "cost_1",
      matter_id: MATTER_ID,
      vendor_id: null,
      incurred_date: "2026-06-25",
      amount_minor: 5000,
      currency: "USD",
      disbursement_class: "hard",
      billable: 1,
      utbms_expense_code_id: null,
      description: "Filing fee",
      receipt_file_id: null,
      status: "draft",
      kick_back_reason: null,
      source: "manual",
      recovery_category: null,
      recovery_ref: null,
      invoice_id: null,
      created_by: ACTOR,
    });
  });

  it("sets status to draft regardless of any caller intent", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const row = await readRow(database, "cost_1");
    expect(row?.status).toBe("draft");
  });

  it("sets invoice_id to null on insert", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const row = await readRow(database, "cost_1");
    expect(row?.invoice_id).toBeNull();
  });

  it("stores a vendor_id when provided", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, {
      ...BASE_ROW,
      vendorId: "vendor_courier",
    }).run();
    const row = await readRow(database, "cost_1");
    expect(row?.vendor_id).toBe("vendor_courier");
  });

  it("stores a soft disbursement class", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, {
      ...BASE_ROW,
      disbursementClass: "soft",
    }).run();
    const row = await readRow(database, "cost_1");
    expect(row?.disbursement_class).toBe("soft");
  });
});

describe("selectCostEntryStatement", () => {
  it("returns status and matter_id for an existing row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const { results } = await selectCostEntryStatement(database, BASE_ROW.id).all<{
      status: string;
      matter_id: string;
    }>();
    expect(results[0]).toMatchObject({ status: "draft", matter_id: MATTER_ID });
  });

  it("returns an empty result set for an unknown id", async () => {
    const database = freshDatabase();
    const { results } = await selectCostEntryStatement(
      database,
      "cost_missing" as CostEntryId,
    ).all();
    expect(results).toHaveLength(0);
  });
});

describe("selectMatterEBillingStatement", () => {
  it("reads e_billing = 0 when the matter has no e-billing", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID, 0);
    const { results } = await selectMatterEBillingStatement(database, MATTER_ID).all<{
      e_billing: number;
    }>();
    expect(results[0]?.e_billing).toBe(0);
  });

  it("reads e_billing = 1 for an e-billing matter", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID, 1);
    const { results } = await selectMatterEBillingStatement(database, MATTER_ID).all<{
      e_billing: number;
    }>();
    expect(results[0]?.e_billing).toBe(1);
  });
});

describe("updateDraftCostStatement", () => {
  it("updates only the patched fields and leaves non-patched fields unchanged", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const patch: CostDraftPatch = { description: "Courier expense", amountMinor: 1200 };
    await updateDraftCostStatement(database, BASE_ROW.id, patch, "2026-06-25T11:00:00.000Z").run();
    const row = await readRow(database, "cost_1");
    expect(row?.description).toBe("Courier expense");
    expect(row?.amount_minor).toBe(1200);
    expect(row?.disbursement_class).toBe("hard"); // not in patch — unchanged
    expect(row?.billable).toBe(1); // not in patch — unchanged
    expect(row?.status).toBe("draft"); // never in patch
    expect(row?.invoice_id).toBeNull(); // never in patch
  });

  it("does not update a submitted row and returns 0 changes", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "draft",
      "submitted",
      clock.now(),
    ).run();
    const { meta } = await updateDraftCostStatement(
      database,
      BASE_ROW.id,
      { description: "Should not apply" },
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
  });

  it("does not touch status even when all other fields are patched", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const patch: CostDraftPatch = {
      description: "Changed",
      amountMinor: 9999,
      currency: "USD",
      disbursementClass: "soft",
      billable: 0,
    };
    await updateDraftCostStatement(database, BASE_ROW.id, patch, clock.now()).run();
    const row = await readRow(database, "cost_1");
    expect(row?.status).toBe("draft");
  });

  it("does not touch recovery_ref or invoice_id", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, {
      ...BASE_ROW,
      recoveryRef: "ref_abc",
    }).run();
    // Manually set invoice_id and recovery_ref to non-null to verify they are not cleared
    await database
      .prepare("UPDATE cost_entry SET invoice_id = 'inv_1', recovery_ref = 'ref_abc' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    await updateDraftCostStatement(
      database,
      BASE_ROW.id,
      { description: "Changed" },
      clock.now(),
    ).run();
    const row = await readRow(database, "cost_1");
    expect(row?.invoice_id).toBe("inv_1");
    expect(row?.recovery_ref).toBe("ref_abc");
  });

  it("clears vendor_id when patch sets it to null", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, { ...BASE_ROW, vendorId: "vendor_x" }).run();
    await updateDraftCostStatement(database, BASE_ROW.id, { vendorId: null }, clock.now()).run();
    const row = await readRow(database, "cost_1");
    expect(row?.vendor_id).toBeNull();
  });
});

describe("transitionCostStatusStatement", () => {
  it("advances status when the from value matches", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const { meta } = await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "draft",
      "submitted",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(1);
    const row = await readRow(database, "cost_1");
    expect(row?.status).toBe("submitted");
  });

  it("returns 0 changes when the from status is stale", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    // Row is draft; we claim it is submitted — should be a no-op
    const { meta } = await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "submitted",
      "approved",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
    const row = await readRow(database, "cost_1");
    expect(row?.status).toBe("draft");
  });

  it("does not touch a billed row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    // Force to billed directly to test the freeze guard
    await database
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "approved",
      "billed",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
  });

  it("does not touch a void row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'void' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "draft",
      "submitted",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
  });

  it("does not touch business columns on transition", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "draft",
      "submitted",
      clock.now(),
    ).run();
    const row = await readRow(database, "cost_1");
    expect(row?.amount_minor).toBe(5000);
    expect(row?.description).toBe("Filing fee");
    expect(row?.disbursement_class).toBe("hard");
  });
});

describe("setCostKickBackReasonStatement", () => {
  it("sets kick_back_reason on a draft row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const { meta } = await setCostKickBackReasonStatement(
      database,
      BASE_ROW.id,
      "Missing receipt",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(1);
    const row = await readRow(database, "cost_1");
    expect(row?.kick_back_reason).toBe("Missing receipt");
  });

  it("sets kick_back_reason on a submitted row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "draft",
      "submitted",
      clock.now(),
    ).run();
    const { meta } = await setCostKickBackReasonStatement(
      database,
      BASE_ROW.id,
      "Amount too high",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(1);
  });

  it("does NOT touch a billed row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await setCostKickBackReasonStatement(
      database,
      BASE_ROW.id,
      "Should not apply",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
    const row = await readRow(database, "cost_1");
    expect(row?.kick_back_reason).toBeNull();
  });

  it("does NOT touch a void row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'void' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await setCostKickBackReasonStatement(
      database,
      BASE_ROW.id,
      "Should not apply",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
  });

  it("clears the reason when set to null", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await setCostKickBackReasonStatement(
      database,
      BASE_ROW.id,
      "Initial reason",
      clock.now(),
    ).run();
    await setCostKickBackReasonStatement(database, BASE_ROW.id, null, clock.now()).run();
    const row = await readRow(database, "cost_1");
    expect(row?.kick_back_reason).toBeNull();
  });
});

describe("attachReceiptStatement", () => {
  it("sets receipt_file_id on a draft row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    const { meta } = await attachReceiptStatement(
      database,
      BASE_ROW.id,
      "file_abc",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(1);
    const row = await readRow(database, "cost_1");
    expect(row?.receipt_file_id).toBe("file_abc");
  });

  it("sets receipt_file_id on a submitted row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await transitionCostStatusStatement(
      database,
      BASE_ROW.id,
      "draft",
      "submitted",
      clock.now(),
    ).run();
    const { meta } = await attachReceiptStatement(
      database,
      BASE_ROW.id,
      "file_xyz",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(1);
  });

  it("refuses to attach a receipt to a billed row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await attachReceiptStatement(
      database,
      BASE_ROW.id,
      "file_abc",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
    const row = await readRow(database, "cost_1");
    expect(row?.receipt_file_id).toBeNull();
  });

  it("refuses to attach a receipt to a void row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, BASE_ROW).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'void' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await attachReceiptStatement(
      database,
      BASE_ROW.id,
      "file_abc",
      clock.now(),
    ).run();
    expect(meta.changes).toBe(0);
  });
});

describe("detachReceiptStatement", () => {
  it("clears receipt_file_id on a draft row that has a receipt", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, { ...BASE_ROW, receiptFileId: "file_xyz" }).run();
    const { meta } = await detachReceiptStatement(database, BASE_ROW.id, clock.now()).run();
    expect(meta.changes).toBe(1);
    const row = await readRow(database, "cost_1");
    expect(row?.receipt_file_id).toBeNull();
  });

  it("refuses to detach on a billed row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, { ...BASE_ROW, receiptFileId: "file_xyz" }).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await detachReceiptStatement(database, BASE_ROW.id, clock.now()).run();
    expect(meta.changes).toBe(0);
    const row = await readRow(database, "cost_1");
    expect(row?.receipt_file_id).toBe("file_xyz");
  });

  it("refuses to detach on a void row", async () => {
    const database = freshDatabase();
    await seedMatter(database, MATTER_ID);
    await insertCostEntryStatement(database, { ...BASE_ROW, receiptFileId: "file_xyz" }).run();
    await database
      .prepare("UPDATE cost_entry SET status = 'void' WHERE id = ?1")
      .bind(BASE_ROW.id)
      .run();
    const { meta } = await detachReceiptStatement(database, BASE_ROW.id, clock.now()).run();
    expect(meta.changes).toBe(0);
  });
});
