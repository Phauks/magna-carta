import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runInterleaved } from "@magna-carta/data-access/interleave";
import type { FeeEntryId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  approveFee,
  captureFee,
  type CaptureFeeInput,
  submitFee,
  updateDraftFee,
  voidFee,
} from "../src/fee-entry-service.ts";

// A fee entry's status is read to decide whether the edit is legal, and the edit commits afterwards.
// Those are two round trips with no transaction across them, so every question these tests ask is
// the same one: when somebody else moves the row inside that window, does the freeze still hold?
//
// The freeze is not enforced by the status read — that read is advisory by the time the batch runs.
// It is enforced by the WHERE clause each statement carries (`AND status = 'draft'`, `AND status =
// <from>`), which matches nothing once the row has moved. These verifiers exist to prove that clause
// is load-bearing, because the read in front of it makes the code look correct either way.

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

async function captured(database: BatchDatabase): Promise<FeeEntryId> {
  const { feeEntryId, effect } = await captureFee(database, capture(), options);
  await commitEffectBatch(database, effect, { now: clock.now });
  return feeEntryId;
}

async function commit(
  database: BatchDatabase,
  built: Promise<{ effect: Parameters<typeof commitEffectBatch>[1] }>,
): Promise<void> {
  const { effect } = await built;
  await commitEffectBatch(database, effect, { now: clock.now });
}

async function rowOf(database: BatchDatabase, id: FeeEntryId) {
  return database
    .prepare("SELECT status, amount_minor, description FROM fee_entry WHERE id = ?1")
    .bind(id)
    .first<{ status: string; amount_minor: number; description: string }>();
}

// Bills the entry the way the invoice run does — the transition the freeze exists to make final.
async function billOutsideTheService(database: BatchDatabase, id: FeeEntryId): Promise<void> {
  await database
    .prepare("UPDATE fee_entry SET status = 'billed', updated_at = ?2 WHERE id = ?1")
    .bind(id, clock.now())
    .run();
}

describe("a draft edit racing the invoice run", () => {
  it("changes nothing once the entry has been billed inside the window", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await expect(
      runInterleaved({
        database,
        concurrentWriter: () => billOutsideTheService(database, id),
        operation: (racing) =>
          commit(racing, updateDraftFee(racing, id, { amountMinor: 999_999 }, options)),
      }),
    ).rejects.toBeInstanceOf(GuardedWriteRefusedError);

    // The read said draft, so the service composed the edit; by the time it committed the row had
    // moved and the statement's own `AND status = 'draft'` matched nothing. That refuses the batch.
    expect(await rowOf(database, id)).toMatchObject({
      status: "billed",
      amount_minor: 125_000,
    });
  });

  it("leaves the amount alone even when the patch touches every editable column", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await expect(
      runInterleaved({
        database,
        concurrentWriter: () => billOutsideTheService(database, id),
        operation: (racing) =>
          commit(
            racing,
            updateDraftFee(
              racing,
              id,
              { amountMinor: 1, description: "rewritten after billing", billable: 0 },
              options,
            ),
          ),
      }),
    ).rejects.toBeInstanceOf(GuardedWriteRefusedError);

    expect(await rowOf(database, id)).toMatchObject({
      status: "billed",
      amount_minor: 125_000,
      description: "Drafting the settlement agreement",
    });
  });
});

describe("two status transitions racing each other", () => {
  it("does not resurrect a voided entry when an approval was already in flight", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);
    await commit(database, submitFee(database, id, true, options));

    // The approver read `submitted`; the void lands before the approval commits.
    await expect(
      runInterleaved({
        database,
        concurrentWriter: () => commit(database, voidFee(database, id, true, options)),
        operation: (racing) => commit(racing, approveFee(racing, id, true, options)),
      }),
    ).rejects.toBeInstanceOf(GuardedWriteRefusedError);

    // `AND status = 'submitted'` no longer matches, so the withdrawal stands. A void that an
    // approval could silently undo would be a charge nobody agreed to re-make.
    expect((await rowOf(database, id))?.status).toBe("void");
  });

  it("does not double-apply when the same transition is committed twice inside the window", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await expect(
      runInterleaved({
        database,
        concurrentWriter: () => commit(database, submitFee(database, id, true, options)),
        operation: (racing) => commit(racing, submitFee(racing, id, true, options)),
      }),
    ).rejects.toBeInstanceOf(GuardedWriteRefusedError);

    expect((await rowOf(database, id))?.status).toBe("submitted");
  });
});

describe("what the loser of the race is told", () => {
  // This used to be the gap the guard did not cover: the statement's WHERE protected the invoice, the
  // affected-row count never left the batch seam, and the member was told a 200 for an edit that
  // changed nothing. A guarded statement now aborts its transaction instead, so the refusal is total
  // and the caller hears about it.
  it("refuses, rather than reporting a success for an edit that changed nothing", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    const caught = await runInterleaved({
      database,
      concurrentWriter: () => billOutsideTheService(database, id),
      operation: (racing) =>
        commit(racing, updateDraftFee(racing, id, { amountMinor: 999_999 }, options)),
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(GuardedWriteRefusedError);
    expect((caught as GuardedWriteRefusedError).guard).toBe("fee-entry.draft-edit");
    expect(await rowOf(database, id)).toMatchObject({ status: "billed", amount_minor: 125_000 });
  });

  it("takes the audit row down with it, so nothing records an edit that never landed", async () => {
    // The audit statement rides the same batch and carries no guard of its own. What keeps it honest
    // is that the guard aborts the TRANSACTION rather than reporting afterwards — checking the row
    // count after the commit would leave this row behind every time.
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await runInterleaved({
      database,
      concurrentWriter: () => billOutsideTheService(database, id),
      operation: (racing) =>
        commit(racing, updateDraftFee(racing, id, { amountMinor: 999_999 }, options)),
    }).catch(() => undefined);

    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1")
      .bind("fee_entry.updated")
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });
});
