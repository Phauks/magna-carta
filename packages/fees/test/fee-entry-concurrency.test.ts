import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
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

    await runInterleaved({
      database,
      concurrentWriter: () => billOutsideTheService(database, id),
      operation: (racing) =>
        commit(racing, updateDraftFee(racing, id, { amountMinor: 999_999 }, options)),
    });

    // The read said draft, so the service composed the edit and the batch committed without error.
    // What protected the invoice is the statement's own `AND status = 'draft'`: it matched no row.
    expect(await rowOf(database, id)).toMatchObject({
      status: "billed",
      amount_minor: 125_000,
    });
  });

  it("leaves the amount alone even when the patch touches every editable column", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await runInterleaved({
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
    });

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
    await runInterleaved({
      database,
      concurrentWriter: () => commit(database, voidFee(database, id, true, options)),
      operation: (racing) => commit(racing, approveFee(racing, id, true, options)),
    });

    // `AND status = 'submitted'` no longer matches, so the withdrawal stands. A void that an
    // approval could silently undo would be a charge nobody agreed to re-make.
    expect((await rowOf(database, id))?.status).toBe("void");
  });

  it("does not double-apply when the same transition is committed twice inside the window", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    const id = await captured(database);

    await runInterleaved({
      database,
      concurrentWriter: () => commit(database, submitFee(database, id, true, options)),
      operation: (racing) => commit(racing, submitFee(racing, id, true, options)),
    });

    expect((await rowOf(database, id))?.status).toBe("submitted");
  });
});

describe("what the loser of the race is told", () => {
  // Recorded because it is the part the guard does NOT cover, and the distinction matters: the
  // freeze protects the INVOICE (asserted above — the row never moves), but it does not protect the
  // person, who is told their edit landed. The statement's WHERE clause is inside a batch, and
  // `batch()` reports no per-statement row count to anyone who could branch on it — `commitEffectBatch`
  // returns void and the route answers 200. So a member who loses this race sees a success for an
  // edit that changed nothing, and finds out by reloading.
  //
  // This test pins today's behavior rather than endorsing it. Changing it means surfacing the
  // affected-row count out of the batch seam and mapping a zero to a conflict — an API contract
  // change, so it is the owner's to make, not a fix to slip in beside a test.
  it("reports success, because the affected-row count never leaves the batch", async () => {
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
    ).resolves.toBeUndefined();

    expect(await rowOf(database, id)).toMatchObject({ status: "billed", amount_minor: 125_000 });
  });
});
