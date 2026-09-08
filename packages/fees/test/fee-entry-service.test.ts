import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FeeEntryId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  approveFee,
  captureFee,
  type CaptureFeeInput,
  deleteDraftFee,
  kickBackFee,
  submitFee,
  updateDraftFee,
  voidFee,
} from "../src/fee-entry-service.ts";
import { FeeValidationError } from "../src/fee-validation.ts";

const clock = { now: () => "2026-09-07T10:00:00.000Z" };
const ACTOR = "user_attorney" as never;
const options = { clock, actorUserId: ACTOR };
const MATTER_ID = "matter_fees";

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMatter(database: BatchDatabase): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(ACTOR, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER_ID, ACTOR, clock.now())
    .run();
}

function capture(overrides: Partial<CaptureFeeInput> = {}): CaptureFeeInput {
  return {
    matterId: MATTER_ID,
    serviceDate: "2026-09-01",
    timekeeperUserId: ACTOR,
    description: "Drafting the settlement agreement",
    amountMinor: 125_000,
    currency: "USD",
    billable: true,
    ...overrides,
  };
}

async function captured(database: BatchDatabase, input = capture()): Promise<FeeEntryId> {
  const { feeEntryId, effect } = await captureFee(database, input, options);
  await commitEffectBatch(database, effect, { now: clock.now });
  return feeEntryId;
}

async function statusOf(database: BatchDatabase, id: FeeEntryId): Promise<string | undefined> {
  const row = await database
    .prepare("SELECT status FROM fee_entry WHERE id = ?1")
    .bind(id)
    .first<{ status: string }>();
  return row?.status;
}

describe("capturing a fee", () => {
  it("writes one draft with the amount exactly as typed", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    const row = await database
      .prepare("SELECT status, amount_minor, billable, service_date FROM fee_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string; amount_minor: number; billable: number; service_date: string }>();
    // Never computed from anything: what somebody decided to charge is what is stored.
    expect(row).toEqual({
      status: "draft",
      amount_minor: 125_000,
      billable: 1,
      service_date: "2026-09-01",
    });
  });

  it("refuses a charge of nothing, because a reduction is a discount line and not a fee", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    await expect(captureFee(database, capture({ amountMinor: 0 }), options)).rejects.toThrow(
      FeeValidationError,
    );
    await expect(captureFee(database, capture({ amountMinor: -500 }), options)).rejects.toThrow(
      FeeValidationError,
    );
    // A fractional minor unit is not a smaller amount, it is a malformed one.
    await expect(captureFee(database, capture({ amountMinor: 12.5 }), options)).rejects.toThrow(
      FeeValidationError,
    );
  });

  it("refuses a currency the store cannot hold, ahead of the table's own CHECK", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    // The guard exists so this is a 422 the caller can act on rather than a 500 from a raw CHECK.
    await expect(captureFee(database, capture({ currency: "EUR" }), options)).rejects.toThrow(
      FeeValidationError,
    );
  });
});

describe("the chain a fee rides", () => {
  it("runs draft to approved with the review gate on", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await commitEffectBatch(database, (await submitFee(database, id, true, options)).effect, {
      now: clock.now,
    });
    expect(await statusOf(database, id)).toBe("submitted");
    await commitEffectBatch(database, (await approveFee(database, id, true, options)).effect, {
      now: clock.now,
    });
    expect(await statusOf(database, id)).toBe("approved");
  });

  it("refuses submission with the gate off, because nothing solicits one", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    // billing-core's own table, not a second copy of it: with the gate off a draft bills directly.
    await expect(submitFee(database, id, false, options)).rejects.toThrow(FeeValidationError);
  });

  it("carries the reviewer's reason back to draft, and the next submission clears it", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    await commitEffectBatch(database, (await submitFee(database, id, true, options)).effect, {
      now: clock.now,
    });

    await commitEffectBatch(
      database,
      (await kickBackFee(database, id, true, options, "This is the Harlow engagement.")).effect,
      { now: clock.now },
    );
    const returned = await database
      .prepare("SELECT status, kick_back_reason FROM fee_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string; kick_back_reason: string | null }>();
    // Back to draft AND carrying the reason: the pair is what tells a returned draft from one
    // nobody has submitted, and neither half says it alone.
    expect(returned).toEqual({
      status: "draft",
      kick_back_reason: "This is the Harlow engagement.",
    });

    await commitEffectBatch(database, (await submitFee(database, id, true, options)).effect, {
      now: clock.now,
    });
    const resent = await database
      .prepare("SELECT status, kick_back_reason FROM fee_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string; kick_back_reason: string | null }>();
    expect(resent).toEqual({ status: "submitted", kick_back_reason: null });
  });

  it("freezes a voided fee against every further act", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    await commitEffectBatch(database, (await voidFee(database, id, false, options)).effect, {
      now: clock.now,
    });
    expect(await statusOf(database, id)).toBe("void");

    // A withdrawn charge stays on the ledger as the record of what was withdrawn; nothing may
    // move it afterwards, in either direction.
    await expect(updateDraftFee(database, id, { amountMinor: 1 }, options)).rejects.toThrow(
      FeeValidationError,
    );
    await expect(submitFee(database, id, true, options)).rejects.toThrow(FeeValidationError);
    await expect(voidFee(database, id, false, options)).rejects.toThrow(FeeValidationError);
  });
});

describe("editing a draft", () => {
  it("rewrites the editable fields and refuses an empty patch", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await commitEffectBatch(
      database,
      (await updateDraftFee(database, id, { amountMinor: 90_000, billable: 0 }, options)).effect,
      { now: clock.now },
    );
    const row = await database
      .prepare("SELECT amount_minor, billable FROM fee_entry WHERE id = ?1")
      .bind(id)
      .first<{ amount_minor: number; billable: number }>();
    expect(row).toEqual({ amount_minor: 90_000, billable: 0 });

    await expect(updateDraftFee(database, id, {}, options)).rejects.toThrow(FeeValidationError);
  });

  it("will not let an edit sneak an amount past the capture guard", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    // The capture refuses a non-positive amount; an edit that did not would be a way around it.
    await expect(updateDraftFee(database, id, { amountMinor: 0 }, options)).rejects.toThrow(
      FeeValidationError,
    );
  });

  it("refuses to edit anything past draft", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    await commitEffectBatch(database, (await submitFee(database, id, true, options)).effect, {
      now: clock.now,
    });
    await expect(updateDraftFee(database, id, { description: "late" }, options)).rejects.toThrow(
      FeeValidationError,
    );
  });
});

describe("deleting a draft, which is not the same act as voiding one", () => {
  it("removes a draft nobody has seen", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await commitEffectBatch(database, (await deleteDraftFee(database, id, options)).effect, {
      now: clock.now,
    });
    expect(await statusOf(database, id)).toBeUndefined();
  });

  it("refuses anything that entered review, which is voided instead", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    await commitEffectBatch(database, (await submitFee(database, id, true, options)).effect, {
      now: clock.now,
    });

    // A record somebody may be asked to account for is never deleted — that is the whole
    // distinction between the two verbs, and it is enforced here rather than in the menu.
    await expect(deleteDraftFee(database, id, options)).rejects.toThrow(FeeValidationError);
    expect(await statusOf(database, id)).toBe("submitted");
  });
});

describe("an unknown fee", () => {
  it("is refused before any effect is composed, so no audit row is minted for a phantom", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const phantom = "feeEntry_000000000000000000000" as FeeEntryId;

    await expect(submitFee(database, phantom, true, options)).rejects.toThrow(FeeValidationError);
    const audits = await database
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id = ?1")
      .bind(phantom)
      .first<{ n: number }>();
    expect(audits?.n).toBe(0);
  });
});
