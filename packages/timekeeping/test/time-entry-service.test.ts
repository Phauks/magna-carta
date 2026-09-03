import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { MatterId, TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  approveTimeEntry,
  captureTimeEntry,
  type CaptureTimeEntryInput,
  kickBackTimeEntry,
  refileTimeEntry,
  submitTimeEntry,
  updateDraftTimeEntry,
  voidTimeEntry,
} from "../src/time-entry-service.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const TIMEKEEPER = "user_attorney" as UserId;
const options = { clock, actorUserId: TIMEKEEPER };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// A matter the capture binds to; e_billing defaults to 0 (off) unless overridden here.
async function seedMatter(database: BatchDatabase, matterId: string, eBilling = 0): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(TIMEKEEPER, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, ?3, ?4, ?4)",
    )
    .bind(matterId, TIMEKEEPER, eBilling, clock.now())
    .run();
}

async function seedRateCard(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO rate_card (id, name, created_at, updated_at) VALUES (?1, 'Standard', ?2, ?2)",
    )
    .bind(id, clock.now())
    .run();
}

async function seedNonBillableCategory(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO non_billable_category (id, name, created_at, updated_at) VALUES (?1, 'Admin', ?2, ?2)",
    )
    .bind(id, clock.now())
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

const billableBase: Omit<CaptureTimeEntryInput, "rate"> = {
  matterId: "matter_1" as MatterId,
  timekeeperUserId: TIMEKEEPER,
  workDate: "2026-06-22",
  rawDurationMinutes: 28,
  durationMinutes: 30,
  narrative: "drafted demand letter",
  billable: true,
  currency: "USD",
  source: "manual",
};

async function readEntry(database: BatchDatabase, id: string) {
  const { results } = await database
    .prepare(
      "SELECT matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, status, source, live_run_id FROM time_entry WHERE id = ?1",
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

describe("captureTimeEntry", () => {
  it("stores a billable entry with its frozen rate snapshot and an audit row", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, timeEntryId);
    expect(row).toMatchObject({
      matter_id: "matter_1",
      timekeeper_user_id: TIMEKEEPER,
      work_date: "2026-06-22",
      duration_minutes: 30,
      raw_duration_minutes: 28,
      narrative: "drafted demand letter",
      billable: 1,
      non_billable_category_id: null,
      currency: "USD",
      rate_e4: 4500000,
      rate_card_id: "rateCard_std",
      rate_source: "matter",
      amount_minor: 2250000,
      status: "draft",
      source: "manual",
    });
    expect(await countAudits(database, "time_entry.captured")).toBe(1);
  });

  it("leaves rate columns null and sets the category on a non-billable capture", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedNonBillableCategory(database, "nonBillableCategory_admin");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        billable: false,
        nonBillableCategoryId: "nonBillableCategory_admin",
        rate: { noRate: true },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, timeEntryId);
    expect(row).toMatchObject({
      billable: 0,
      non_billable_category_id: "nonBillableCategory_admin",
      rate_e4: null,
      rate_card_id: null,
      rate_source: null,
      amount_minor: null, // paired-null with rate_e4 — both null for non-billable internal time
    });
  });

  it("carries the live_run_id through for a timer-sourced capture", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        source: "timer",
        liveRunId: "run_abc",
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    expect((await readEntry(database, timeEntryId))?.live_run_id).toBe("run_abc");
  });

  it("refuses a billable capture on an e_billing matter without a UTBMS task code", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await expect(
      captureTimeEntry(
        database,
        {
          ...billableBase,
          rate: {
            rateE4: 4500000,
            rateCardId: "rateCard_std",
            rateSource: "matter",
            currency: "USD",
            amountMinor: 2250000,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "utbms-required" });
  });

  it("accepts an e_billing capture once a UTBMS task code is supplied", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await seedRateCard(database, "rateCard_std");
    await seedUtbms(database, "utbmsCode_l120", "task", "L120");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        utbmsTaskCodeId: "utbmsCode_l120",
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    expect((await readEntry(database, timeEntryId))?.utbms_task_code_id).toBe("utbmsCode_l120");
  });
});

it("TimeEntryValidationError carries a stable code", () => {
  expect(new TimeEntryValidationError("utbms-required", "x").code).toBe("utbms-required");
});

async function captureDraft(database: BatchDatabase, matterId = "matter_1"): Promise<string> {
  const { timeEntryId, effect } = await captureTimeEntry(
    database,
    {
      ...billableBase,
      matterId: matterId as MatterId,
      rate: {
        rateE4: 4500000,
        rateCardId: "rateCard_std",
        rateSource: "matter",
        currency: "USD",
        amountMinor: 2250000,
      },
    },
    options,
  );
  await commitEffectBatch(database, effect, { now: clock.now });
  return timeEntryId;
}

async function statusOf(database: BatchDatabase, id: string): Promise<string | undefined> {
  const { results } = await database
    .prepare("SELECT status FROM time_entry WHERE id = ?1")
    .bind(id)
    .all<{ status: string }>();
  return results[0]?.status;
}

async function billEntry(database: BatchDatabase, id: string): Promise<void> {
  // Stand in for the billing lock the financial core sets when an entry is invoiced.
  await database
    .prepare("UPDATE time_entry SET status = 'billed', invoice_id = 'invoice_x' WHERE id = ?1")
    .bind(id)
    .run();
}

describe("refileTimeEntry", () => {
  /*
   * Moving a misfiled entry keeps the record and re-asks what the matter answers. The entry number
   * is the load-bearing half: a reference that changes is a reference that lies, so anything that
   * cited it has to keep resolving — which is why the move carries it rather than re-minting.
   */
  async function seedTwoMatters(database: BatchDatabase): Promise<void> {
    await seedMatter(database, "matter_1");
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Pemberton v. Hale', 'open', ?2, 0, ?3, ?3)",
      )
      .bind("matter_2", TIMEKEEPER, clock.now())
      .run();
  }

  async function capturedDraft(database: BatchDatabase): Promise<TimeEntryId> {
    const captured = await captureTimeEntry(
      database,
      { ...billableBase, rate: { noRate: true } },
      options,
    );
    await commitEffectBatch(database, captured.effect, { now: clock.now });
    return captured.timeEntryId;
  }

  it("moves the entry, keeping its number and taking the new matter's figures", async () => {
    const database = freshDatabase();
    await seedTwoMatters(database);
    const id = await capturedDraft(database);
    const before = await readEntry(database, id);

    const moved = await refileTimeEntry(
      database,
      id,
      {
        fromMatterId: "matter_1",
        matterId: "matter_2",
        durationMinutes: 45,
        rateE4: 3_400_000,
        rateCardId: null,
        rateSource: "matter",
        amountMinor: 25_500,
        currency: "USD",
      },
      options,
    );
    await commitEffectBatch(database, moved.effect, { now: clock.now });

    const after = await readEntry(database, id);
    expect(after?.matter_id).toBe("matter_2");
    expect(after?.duration_minutes).toBe(45);
    expect(after?.rate_e4).toBe(3_400_000);
    expect(after?.amount_minor).toBe(25_500);
    // Everything that identifies the entry survives the move.
    expect(after?.narrative).toBe(before?.narrative);
    expect(after?.work_date).toBe(before?.work_date);
    expect(after?.timekeeper_user_id).toBe(before?.timekeeper_user_id);
    expect(await countAudits(database, "time_entry.refiled")).toBe(1);
  });

  it("keeps the entry number, because a reference that changes is a reference that lies", async () => {
    const database = freshDatabase();
    await seedTwoMatters(database);
    const id = await capturedDraft(database);
    await database
      .prepare("UPDATE time_entry SET entry_number = ?2 WHERE id = ?1")
      .bind(id, "2026-0147.0042")
      .run();

    const moved = await refileTimeEntry(
      database,
      id,
      {
        fromMatterId: "matter_1",
        matterId: "matter_2",
        durationMinutes: 30,
        rateE4: null,
        rateCardId: null,
        rateSource: null,
        amountMinor: null,
        currency: "USD",
      },
      options,
    );
    await commitEffectBatch(database, moved.effect, { now: clock.now });

    const { results } = await database
      .prepare("SELECT entry_number FROM time_entry WHERE id = ?1")
      .bind(id)
      .all<{ entry_number: string | null }>();
    expect(results[0]?.entry_number).toBe("2026-0147.0042");
  });

  it("names both matters on the audit row, so the move is legible afterwards", async () => {
    const database = freshDatabase();
    await seedTwoMatters(database);
    const id = await capturedDraft(database);
    const moved = await refileTimeEntry(
      database,
      id,
      {
        fromMatterId: "matter_1",
        matterId: "matter_2",
        durationMinutes: 30,
        rateE4: null,
        rateCardId: null,
        rateSource: null,
        amountMinor: null,
        currency: "USD",
      },
      options,
    );
    await commitEffectBatch(database, moved.effect, { now: clock.now });

    const { results } = await database
      .prepare("SELECT metadata FROM audit_log WHERE event = 'time_entry.refiled'")
      .all<{ metadata: string }>();
    const metadata = JSON.parse(results[0]?.metadata ?? "{}") as Record<string, unknown>;
    expect(metadata["fromMatterId"]).toBe("matter_1");
    expect(metadata["toMatterId"]).toBe("matter_2");
  });

  it("refuses a move to the matter it is already on, rather than reporting a move that moved nothing", async () => {
    const database = freshDatabase();
    await seedTwoMatters(database);
    const id = await capturedDraft(database);
    await expect(
      refileTimeEntry(
        database,
        id,
        {
          fromMatterId: "matter_1",
          matterId: "matter_1",
          durationMinutes: 30,
          rateE4: null,
          rateCardId: null,
          rateSource: null,
          amountMinor: null,
          currency: "USD",
        },
        options,
      ),
    ).rejects.toThrow(TimeEntryValidationError);
  });

  /*
   * Past draft the entry is evidence somebody is relying on — an approved entry is a reviewer's
   * decision about a matter, a billed one a line on a finalized bill — and the answer to both is a
   * void and a fresh record, never a move nobody can see.
   */
  it("refuses anything past draft", async () => {
    const database = freshDatabase();
    await seedTwoMatters(database);
    const id = await capturedDraft(database);
    await database.prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1").bind(id).run();

    await expect(
      refileTimeEntry(
        database,
        id,
        {
          fromMatterId: "matter_1",
          matterId: "matter_2",
          durationMinutes: 30,
          rateE4: null,
          rateCardId: null,
          rateSource: null,
          amountMinor: null,
          currency: "USD",
        },
        options,
      ),
    ).rejects.toThrow(TimeEntryValidationError);
  });
});

describe("time-entry lifecycle (review gate on)", () => {
  const gateOn = { ...options, approvalRequired: true } as const;

  it("rewrites a draft via updateDraftTimeEntry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);
    const { effect } = await updateDraftTimeEntry(
      database,
      id as never,
      { narrative: "revised narrative", durationMinutes: 42 },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    const { results } = await database
      .prepare("SELECT narrative, duration_minutes FROM time_entry WHERE id = ?1")
      .bind(id)
      .all<{ narrative: string; duration_minutes: number }>();
    expect(results[0]).toMatchObject({ narrative: "revised narrative", duration_minutes: 42 });
  });

  it("refuses to update a billed (frozen) entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);
    await billEntry(database, id);
    await expect(
      updateDraftTimeEntry(database, id as never, { narrative: "no" }, options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });

  it("walks draft -> submitted -> approved and audits each step", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);

    const submit = await submitTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, submit.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("submitted");

    const approve = await approveTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, approve.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("approved");

    expect(await countAudits(database, "time_entry.submitted")).toBe(1);
    expect(await countAudits(database, "time_entry.approved")).toBe(1);
  });

  it("kicks a submitted entry back to draft, stores the reason on the entry, and audits with null metadata", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);
    const submit = await submitTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, submit.effect, { now: clock.now });

    const kick = await kickBackTimeEntry(database, id as never, { reason: "wrong matter" }, gateOn);
    await commitEffectBatch(database, kick.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("draft");

    // The reason rides the entry column, not the audit log.
    const { results: entryRows } = await database
      .prepare("SELECT kick_back_reason FROM time_entry WHERE id = ?1")
      .bind(id)
      .all<{ kick_back_reason: string | null }>();
    expect(entryRows[0]?.kick_back_reason).toBe("wrong matter");

    // The audit row records who/when only; metadata stays null (no privileged free-text in the log).
    const { results: auditRows } = await database
      .prepare("SELECT metadata FROM audit_log WHERE event = 'time_entry.kicked_back'")
      .all<{ metadata: string | null }>();
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.metadata).toBeNull();
  });

  it("clears kick_back_reason to null when the entry is resubmitted", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);

    const submit1 = await submitTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, submit1.effect, { now: clock.now });

    const kick = await kickBackTimeEntry(database, id as never, { reason: "wrong matter" }, gateOn);
    await commitEffectBatch(database, kick.effect, { now: clock.now });

    // Confirm the reason was set before resubmit.
    const { results: before } = await database
      .prepare("SELECT kick_back_reason FROM time_entry WHERE id = ?1")
      .bind(id)
      .all<{ kick_back_reason: string | null }>();
    expect(before[0]?.kick_back_reason).toBe("wrong matter");

    // Resubmit — the reviewer's note is consumed; it must not linger on the entry.
    const submit2 = await submitTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, submit2.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("submitted");

    const { results: after } = await database
      .prepare("SELECT kick_back_reason FROM time_entry WHERE id = ?1")
      .bind(id)
      .all<{ kick_back_reason: string | null }>();
    expect(after[0]?.kick_back_reason).toBeNull();
  });

  it("refuses an illegal transition (approve a draft directly when the gate is on)", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);
    await expect(approveTimeEntry(database, id as never, gateOn)).rejects.toMatchObject({
      code: "illegal-transition",
    });
  });

  it("voids a draft and then refuses any further update", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    await seedRateCard(database, "rateCard_std");
    const id = await captureDraft(database);
    const voided = await voidTimeEntry(database, id as never, options);
    await commitEffectBatch(database, voided.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("void");
    await expect(
      updateDraftTimeEntry(database, id as never, { narrative: "no" }, options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });
});
