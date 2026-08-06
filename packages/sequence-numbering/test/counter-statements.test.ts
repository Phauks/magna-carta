import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { InvoiceId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { drawWithBoundedRetry } from "../src/bounded-retry.ts";
import {
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  guardedIncrementStatement,
  isNumberAllocationConflict,
  readCounterValue,
  type SequenceNumberingTables,
} from "../src/counter-statements.ts";

// Two real sequences on the shipped per-firm schema rather than a bespoke pair of tables: the point
// of the parameterization is that ONE mechanism serves several owners, and a test on a table nobody
// draws from would prove only that the SQL string interpolates.
const MATTER_TABLES: SequenceNumberingTables = {
  counterTable: "matter_number_counter",
  allocationTable: "matter_number_allocation",
  ownerColumn: "matter_id",
};

const INVOICE_TABLES: SequenceNumberingTables = {
  counterTable: "invoice_number_counter",
  allocationTable: "invoice_number_allocation",
  ownerColumn: "invoice_id",
};

const NOW = "2026-08-05T15:00:00.000Z";

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// The node:sqlite adapter surfaces a constraint failure as a synchronous throw from run(), so a
// rejects-matcher would never see it.
async function captureError(act: () => Promise<unknown>): Promise<unknown> {
  try {
    await act();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the statement to fail on a constraint");
}

async function seedMatter(database: BatchDatabase): Promise<MatterId> {
  const memberUserId = newIdentifier("user") as UserId;
  const matterId = newIdentifier("matter") as MatterId;
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(memberUserId, NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Smith v. Jones', 'prospective', ?2, ?3, ?3)",
    )
    .bind(matterId, memberUserId, NOW)
    .run();
  return matterId;
}

async function seedDraftInvoice(database: BatchDatabase): Promise<InvoiceId> {
  const invoiceId = newIdentifier("invoice") as InvoiceId;
  await database
    .prepare(
      "INSERT INTO invoice (id, client_entity_id, currency, status, created_at, updated_at) VALUES (?1, 'directoryOrganization_acme', 'USD', 'draft', ?2, ?2)",
    )
    .bind(invoiceId, NOW)
    .run();
  return invoiceId;
}

describe("the shared sequence-numbering statements", () => {
  it("ensure-row inserts at the start value when absent and never overwrites an existing row", async () => {
    const database = freshDatabase();
    await ensureCounterRowStatement(database, MATTER_TABLES, "RENO:26", 100).run();
    expect(await readCounterValue(database, MATTER_TABLES, "RENO:26")).toBe(100);
    // A second ensure with a different start must NOT clobber the existing counter.
    await ensureCounterRowStatement(database, MATTER_TABLES, "RENO:26", 1).run();
    expect(await readCounterValue(database, MATTER_TABLES, "RENO:26")).toBe(100);
  });

  it("readCounterValue returns undefined for an absent scope", async () => {
    const database = freshDatabase();
    expect(await readCounterValue(database, INVOICE_TABLES, "")).toBeUndefined();
  });

  it("guarded increment advances only when the observed value still matches", async () => {
    const database = freshDatabase();
    await ensureCounterRowStatement(database, INVOICE_TABLES, "", 1).run();
    const advanced = await guardedIncrementStatement(database, INVOICE_TABLES, "", 1).run();
    expect(advanced.meta.changes).toBe(1);
    expect(await readCounterValue(database, INVOICE_TABLES, "")).toBe(2);
    // A stale observed value matches no row — a no-op, which is the losing concurrent draw and is
    // exactly why the guarded UPDATE cannot be the guard.
    const stale = await guardedIncrementStatement(database, INVOICE_TABLES, "", 1).run();
    expect(stale.meta.changes).toBe(0);
    expect(await readCounterValue(database, INVOICE_TABLES, "")).toBe(2);
  });

  it("one counter value allocates once per scope, and independently in a second scope", async () => {
    const database = freshDatabase();
    const first = await seedMatter(database);
    const second = await seedMatter(database);
    await allocateCounterValueStatement(database, MATTER_TABLES, "RENO", 1, first, NOW).run();
    // Same value, different scope — counters reset per scope, so this is not a collision.
    await allocateCounterValueStatement(database, MATTER_TABLES, "VEGAS", 1, second, NOW).run();
    const conflict = await captureError(() =>
      allocateCounterValueStatement(database, MATTER_TABLES, "RENO", 1, second, NOW).run(),
    );
    expect(isNumberAllocationConflict(conflict, MATTER_TABLES)).toBe(true);
    expect(String(conflict)).toContain("UNIQUE constraint failed");
  });

  it("the invoice allocation's own no-overwrite guard reports the same losing draw", async () => {
    const database = freshDatabase();
    const first = await seedDraftInvoice(database);
    const second = await seedDraftInvoice(database);
    await allocateCounterValueStatement(database, INVOICE_TABLES, "RENO", 1, first, NOW).run();
    await allocateCounterValueStatement(database, INVOICE_TABLES, "VEGAS", 1, second, NOW).run();
    const conflict = await captureError(() =>
      allocateCounterValueStatement(database, INVOICE_TABLES, "RENO", 1, second, NOW).run(),
    );
    expect(isNumberAllocationConflict(conflict, INVOICE_TABLES)).toBe(true);
  });

  it("two sequences are independent: one owner's allocation never collides with the other's", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const invoiceId = await seedDraftInvoice(database);
    await allocateCounterValueStatement(database, MATTER_TABLES, "", 1, matterId, NOW).run();
    await allocateCounterValueStatement(database, INVOICE_TABLES, "", 1, invoiceId, NOW).run();
    expect(await readCounterValue(database, MATTER_TABLES, "")).toBeUndefined();
  });

  it("isNumberAllocationConflict recognizes only its own allocation constraint", () => {
    const matterConflict = new Error(
      "UNIQUE constraint failed: matter_number_allocation.scope_key, matter_number_allocation.drawn_value",
    );
    expect(isNumberAllocationConflict(matterConflict, MATTER_TABLES)).toBe(true);
    // The other sequence's conflict is not this sequence's to retry.
    expect(isNumberAllocationConflict(matterConflict, INVOICE_TABLES)).toBe(false);
    expect(
      isNumberAllocationConflict(
        new Error("UNIQUE constraint failed: matter.matter_number"),
        MATTER_TABLES,
      ),
    ).toBe(false);
    expect(isNumberAllocationConflict("not an error", MATTER_TABLES)).toBe(false);
  });

  it("recognizes the append-only guard a consumer's allocation table may fire first", () => {
    // The invoice allocation carries a BEFORE INSERT no-overwrite guard, which fires ahead of the
    // primary key on a duplicate draw. Same event, same retry.
    const guarded = new Error("invoice_number_allocation is append-only");
    expect(isNumberAllocationConflict(guarded, INVOICE_TABLES)).toBe(true);
    expect(isNumberAllocationConflict(guarded, MATTER_TABLES)).toBe(false);
  });
});

describe("the bounded-retry draw", () => {
  it("loses the draw once, advances the counter out of band, and converges on the next value", async () => {
    const database = freshDatabase();
    const winner = await seedDraftInvoice(database);
    const loser = await seedDraftInvoice(database);
    // The winner has already taken value 1 in this scope — the state a losing drawer's batch finds
    // when it commits against the value it read.
    await ensureCounterRowStatement(database, INVOICE_TABLES, "", 1).run();
    await guardedIncrementStatement(database, INVOICE_TABLES, "", 1).run();
    await allocateCounterValueStatement(database, INVOICE_TABLES, "", 1, winner, NOW).run();

    // The loser observes a STALE value 1 on its first attempt (the read it made before the winner
    // committed), then re-reads on the retry.
    let observedValues: number[] = [];
    let attempts = 0;
    const drawn = await drawWithBoundedRetry(
      database,
      INVOICE_TABLES,
      { sequenceLabel: "invoice number" },
      async (observe) => {
        attempts += 1;
        const observedValue =
          attempts === 1 ? 1 : ((await readCounterValue(database, INVOICE_TABLES, "")) ?? 1);
        observedValues.push(observedValue);
        observe({ scopeKey: "", observedValue, startValue: 1 });
        await database.batch([
          ensureCounterRowStatement(database, INVOICE_TABLES, "", 1),
          guardedIncrementStatement(database, INVOICE_TABLES, "", observedValue),
          allocateCounterValueStatement(database, INVOICE_TABLES, "", observedValue, loser, NOW),
        ]);
        return observedValue;
      },
    );

    expect(attempts).toBe(2);
    expect(observedValues).toEqual([1, 2]);
    expect(drawn).toBe(2);
    // Gapless: the two draws consumed 1 and 2, and the counter stands ready to hand out 3.
    expect(await readCounterValue(database, INVOICE_TABLES, "")).toBe(3);
  });

  it("rethrows a failure that is not a draw race, without retrying", async () => {
    const database = freshDatabase();
    let attempts = 0;
    await expect(
      drawWithBoundedRetry(database, INVOICE_TABLES, { sequenceLabel: "invoice number" }, () => {
        attempts += 1;
        return Promise.reject(new Error("the batch failed for an unrelated reason"));
      }),
    ).rejects.toThrow("the batch failed for an unrelated reason");
    expect(attempts).toBe(1);
  });

  it("gives up by name once the attempt bound is exhausted", async () => {
    const database = freshDatabase();
    const invoiceId = await seedDraftInvoice(database);
    await allocateCounterValueStatement(database, INVOICE_TABLES, "", 1, invoiceId, NOW).run();
    let attempts = 0;
    await expect(
      drawWithBoundedRetry(
        database,
        INVOICE_TABLES,
        { sequenceLabel: "invoice number", maxAttempts: 3 },
        async (observe) => {
          attempts += 1;
          // Always observes the taken value, so every attempt loses on the allocation key.
          observe({ scopeKey: "", observedValue: 1, startValue: 1 });
          await allocateCounterValueStatement(
            database,
            INVOICE_TABLES,
            "",
            1,
            invoiceId,
            NOW,
          ).run();
        },
      ),
    ).rejects.toThrow("invoice number allocation did not converge after 3 attempts");
    expect(attempts).toBe(3);
  });

  it("retries a caller's own collision when it declares one, and nothing else", async () => {
    const database = freshDatabase();
    let attempts = 0;
    const result = await drawWithBoundedRetry(
      database,
      MATTER_TABLES,
      {
        sequenceLabel: "matter number",
        alsoRetryable: (error) =>
          error instanceof Error && error.message.includes("matter.matter_number"),
      },
      (observe) => {
        attempts += 1;
        observe({ scopeKey: "", observedValue: attempts, startValue: 1 });
        if (attempts === 1) {
          return Promise.reject(new Error("UNIQUE constraint failed: matter.matter_number"));
        }
        return Promise.resolve("drawn");
      },
    );
    expect(result).toBe("drawn");
    expect(attempts).toBe(2);
  });
});
