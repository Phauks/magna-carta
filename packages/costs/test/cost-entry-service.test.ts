import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { CostEntryId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  approveCost,
  attachReceipt,
  captureCost,
  type CaptureCostInput,
  detachReceipt,
  kickBackCost,
  submitCost,
  updateDraftCost,
  voidCost,
} from "../src/cost-entry-service.ts";
import { CostValidationError } from "../src/cost-validation.ts";

const clock = { now: () => "2026-06-25T10:00:00.000Z" };
const ACTOR = "user_attorney" as never;
const options = { clock, actorUserId: ACTOR };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// A matter the capture binds to; e_billing defaults to 0 (off) unless overridden here.
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

async function seedUtbms(
  database: BatchDatabase,
  id: string,
  codeSet: string,
  code: string,
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO utbms_code (id, code_set, code, label, active) VALUES (?1, ?2, ?3, ?4, 1)",
    )
    .bind(id, codeSet, code, `${code} label`)
    .run();
}

const BASE_INPUT: CaptureCostInput = {
  matterId: "matter_1" as MatterId,
  incurredDate: "2026-06-25",
  amountMinor: 5000,
  currency: "USD",
  disbursementClass: "hard",
  billable: true,
  description: "Filing fee",
  source: "manual",
};

async function readEntry(
  database: BatchDatabase,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const { results } = await database
    .prepare(
      "SELECT matter_id, vendor_id, incurred_date, amount_minor, currency, disbursement_class, billable, utbms_expense_code_id, description, status, source FROM cost_entry WHERE id = ?1",
    )
    .bind(id)
    .all();
  return results[0] as Record<string, unknown> | undefined;
}

async function countAudits(database: BatchDatabase, event: string): Promise<number> {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ n: number }>();
  return results[0]?.n ?? 0;
}

describe("captureCost", () => {
  it("stores a draft cost entry with integer amount_minor and an audit row", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const { costEntryId, effect } = await captureCost(database, BASE_INPUT, options);
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, costEntryId);
    expect(row).toMatchObject({
      matter_id: "matter_1",
      vendor_id: null,
      incurred_date: "2026-06-25",
      amount_minor: 5000,
      currency: "USD",
      disbursement_class: "hard",
      billable: 1,
      utbms_expense_code_id: null,
      description: "Filing fee",
      status: "draft",
      source: "manual",
    });
    expect(await countAudits(database, "cost_entry.captured")).toBe(1);
  });

  it("refuses a non-positive amount_minor (zero)", async () => {
    const database = freshDatabase();
    // No matter seeded — the amount guard fires before any DB read.
    await expect(
      captureCost(database, { ...BASE_INPUT, amountMinor: 0 }, options),
    ).rejects.toMatchObject({ code: "non-positive-amount" });
  });

  it("refuses a negative amount_minor", async () => {
    const database = freshDatabase();
    await expect(
      captureCost(database, { ...BASE_INPUT, amountMinor: -100 }, options),
    ).rejects.toMatchObject({ code: "non-positive-amount" });
  });

  it("refuses a fractional amount_minor (non-integer minor units)", async () => {
    const database = freshDatabase();
    // No matter seeded — the integer guard fires before any DB read.
    await expect(
      captureCost(database, { ...BASE_INPUT, amountMinor: 100.5 }, options),
    ).rejects.toMatchObject({ code: "non-positive-amount" });
  });

  it("refuses a billable capture on an e_billing matter without a UTBMS expense code", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await expect(captureCost(database, BASE_INPUT, options)).rejects.toMatchObject({
      code: "utbms-required",
    });
  });

  it("accepts a billable e_billing capture once a UTBMS expense code is supplied", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await seedUtbms(database, "utbmsCode_e101", "expense", "E101");
    const { costEntryId, effect } = await captureCost(
      database,
      { ...BASE_INPUT, utbmsExpenseCodeId: "utbmsCode_e101" },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    const row = await readEntry(database, costEntryId);
    expect(row?.utbms_expense_code_id).toBe("utbmsCode_e101");
    expect(row?.status).toBe("draft");
  });
});

it("CostValidationError carries a stable code", () => {
  expect(new CostValidationError("utbms-required", "x").code).toBe("utbms-required");
});

async function captureDraft(database: BatchDatabase, matterId = "matter_1"): Promise<string> {
  const { costEntryId, effect } = await captureCost(
    database,
    { ...BASE_INPUT, matterId: matterId as MatterId },
    options,
  );
  await commitEffectBatch(database, effect, { now: clock.now });
  return costEntryId;
}

async function statusOf(database: BatchDatabase, id: string): Promise<string | undefined> {
  const { results } = await database
    .prepare("SELECT status FROM cost_entry WHERE id = ?1")
    .bind(id)
    .all<{ status: string }>();
  return results[0]?.status;
}

async function billEntry(database: BatchDatabase, id: string): Promise<void> {
  // Stand in for the billing lock the financial core sets when an entry is invoiced.
  await database
    .prepare("UPDATE cost_entry SET status = 'billed', invoice_id = 'invoice_x' WHERE id = ?1")
    .bind(id)
    .run();
}

describe("cost-entry lifecycle (review gate on)", () => {
  const gateOn = true;

  it("submitCost on an unknown id throws not-found with no audit row composed", async () => {
    const database = freshDatabase();
    await expect(
      submitCost(database, "cost_missing" as CostEntryId, gateOn, options),
    ).rejects.toMatchObject({ code: "not-found" });
    // The throw precedes effect composition — no audit statement is ever constructed.
    expect(await countAudits(database, "cost_entry.submitted")).toBe(0);
  });

  it("walks draft -> submitted -> approved and audits each step", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const submit = await submitCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, submit.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("submitted");

    const approve = await approveCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, approve.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("approved");

    expect(await countAudits(database, "cost_entry.submitted")).toBe(1);
    expect(await countAudits(database, "cost_entry.approved")).toBe(1);
  });

  it("kicks a submitted entry back to draft, stores the reason on the entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const submit = await submitCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, submit.effect, { now: clock.now });

    const kick = await kickBackCost(database, id as never, gateOn, options, "missing receipt");
    await commitEffectBatch(database, kick.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("draft");

    const { results } = await database
      .prepare("SELECT kick_back_reason FROM cost_entry WHERE id = ?1")
      .bind(id)
      .all<{ kick_back_reason: string | null }>();
    expect(results[0]?.kick_back_reason).toBe("missing receipt");

    // Audit row records who/when only; metadata stays null.
    const { results: auditRows } = await database
      .prepare("SELECT metadata FROM audit_log WHERE event = 'cost_entry.kicked_back'")
      .all<{ metadata: string | null }>();
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.metadata).toBeNull();
  });

  it("clears kick_back_reason to null when the entry is resubmitted", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const submit1 = await submitCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, submit1.effect, { now: clock.now });

    const kick = await kickBackCost(database, id as never, gateOn, options, "wrong matter");
    await commitEffectBatch(database, kick.effect, { now: clock.now });

    const submit2 = await submitCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, submit2.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("submitted");

    const { results } = await database
      .prepare("SELECT kick_back_reason FROM cost_entry WHERE id = ?1")
      .bind(id)
      .all<{ kick_back_reason: string | null }>();
    expect(results[0]?.kick_back_reason).toBeNull();
  });

  it("refuses an illegal transition (approve a draft directly when the gate is on)", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await expect(approveCost(database, id as never, gateOn, options)).rejects.toMatchObject({
      code: "illegal-transition",
    });
  });

  it("refuses to update a billed (frozen) entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await billEntry(database, id);
    await expect(
      updateDraftCost(database, id as never, { description: "no" }, options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });

  it("refuses an empty patch", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await expect(updateDraftCost(database, id as never, {}, options)).rejects.toMatchObject({
      code: "empty-patch",
    });
  });

  it("voids a draft cost entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const voided = await voidCost(database, id as never, false, options);
    await commitEffectBatch(database, voided.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("void");

    // A void entry is frozen — no further update is possible.
    await expect(
      updateDraftCost(database, id as never, { description: "no" }, options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });

  it("updateDraftCost on an unknown id throws not-found with no audit row composed", async () => {
    const database = freshDatabase();
    await expect(
      updateDraftCost(database, "costEntry_missing" as CostEntryId, { description: "x" }, options),
    ).rejects.toMatchObject({ code: "not-found" });
    // The throw precedes effect composition — no audit statement is ever constructed.
    expect(await countAudits(database, "cost_entry.updated")).toBe(0);
  });

  it("refuses updateDraftCost on a submitted (non-draft) entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    // Advance to submitted so the entry is no longer draft.
    const submit = await submitCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, submit.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("submitted");

    await expect(
      updateDraftCost(database, id as never, { description: "late edit" }, options),
    ).rejects.toMatchObject({ code: "draft-only" });
  });
});

describe("cost-entry lifecycle (review gate off)", () => {
  const gateOn = false;

  it("gate-off: voiding a draft succeeds (void is always reachable from a non-frozen entry)", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const voided = await voidCost(database, id as never, gateOn, options);
    await commitEffectBatch(database, voided.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("void");
    expect(await countAudits(database, "cost_entry.voided")).toBe(1);
  });

  it("gate-off: submitting a draft is refused (draft -> submitted is a gate-on-only move)", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    // With the gate off the only forward move from draft is straight to billed (done by the
    // billing lock) or void; draft -> submitted is a gate-on-only transition.
    await expect(submitCost(database, id as never, gateOn, options)).rejects.toMatchObject({
      code: "illegal-transition",
    });
  });
});

async function receiptOf(database: BatchDatabase, id: string): Promise<string | null | undefined> {
  const { results } = await database
    .prepare("SELECT receipt_file_id FROM cost_entry WHERE id = ?1")
    .bind(id)
    .all<{ receipt_file_id: string | null }>();
  return results[0]?.receipt_file_id;
}

describe("cost-entry receipt attach/detach", () => {
  it("attachReceipt sets receipt_file_id on a draft entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const attached = await attachReceipt(database, id as never, "file_receipt_a", options);
    await commitEffectBatch(database, attached.effect, { now: clock.now });

    expect(await receiptOf(database, id)).toBe("file_receipt_a");
    expect(await countAudits(database, "cost_entry.receipt_attached")).toBe(1);
  });

  it("attachReceipt on an unknown id throws not-found with no audit row composed", async () => {
    const database = freshDatabase();
    await expect(
      attachReceipt(database, "costEntry_missing" as CostEntryId, "file_receipt_a", options),
    ).rejects.toMatchObject({ code: "not-found" });
    // The throw precedes effect composition — no audit statement is ever constructed.
    expect(await countAudits(database, "cost_entry.receipt_attached")).toBe(0);
  });

  it("attachReceipt on a billed (frozen) entry throws frozen-entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await billEntry(database, id);
    await expect(
      attachReceipt(database, id as never, "file_receipt_a", options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });

  it("detachReceipt clears receipt_file_id on an entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const attached = await attachReceipt(database, id as never, "file_receipt_a", options);
    await commitEffectBatch(database, attached.effect, { now: clock.now });
    expect(await receiptOf(database, id)).toBe("file_receipt_a");

    const detached = await detachReceipt(database, id as never, options);
    await commitEffectBatch(database, detached.effect, { now: clock.now });

    expect(await receiptOf(database, id)).toBeNull();
    expect(await countAudits(database, "cost_entry.receipt_detached")).toBe(1);
  });

  it("detachReceipt on a billed (frozen) entry throws frozen-entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await billEntry(database, id);
    await expect(detachReceipt(database, id as never, options)).rejects.toMatchObject({
      code: "frozen-entry",
    });
  });
});
