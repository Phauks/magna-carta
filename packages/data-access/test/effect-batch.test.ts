import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { commitEffectBatch } from "../src/effect-batch.ts";
import { stubD1 } from "./support/stub-d1.ts";

const NOW = () => "2026-06-09T00:00:00.000Z";

function completedRecord() {
  return {
    id: newIdentifier("idempotencyRecord"),
    key: "client-key-1",
    fingerprint: "f".repeat(64),
    responseCode: 201,
    responseBody: '{"id":"inv_x"}',
    createdAt: NOW(),
  };
}

describe("commitEffectBatch", () => {
  it("commits ONE batch ordered idempotency record -> business statements -> outbox rows", async () => {
    const stub = stubD1();
    const business = stub.database.prepare("UPDATE ledger SET balance_minor = ?1").bind(100);
    await commitEffectBatch(
      stub.database,
      { statements: [business], outboxMessages: [{ topic: "payment.capture", payload: { x: 1 } }] },
      { idempotencyRecord: completedRecord(), now: NOW },
    );
    expect(stub.batches).toHaveLength(1); // atomicity: one batch, one transaction
    const sqls = (stub.batches[0] ?? []).map((statement) => statement.sql);
    expect(sqls[0]).toContain("INSERT INTO idempotency_key"); // conflict gate fires FIRST
    expect(sqls[1]).toContain("UPDATE ledger");
    expect(sqls[2]).toContain("INSERT INTO outbox");
  });

  it("composes without a record (optional route, no Idempotency-Key header)", async () => {
    const stub = stubD1();
    const business = stub.database.prepare("UPDATE a SET b = 1");
    await commitEffectBatch(
      stub.database,
      { statements: [business], outboxMessages: [] },
      { now: NOW },
    );
    const sqls = (stub.batches[0] ?? []).map((statement) => statement.sql);
    expect(sqls).toEqual(["UPDATE a SET b = 1"]);
  });

  it("an empty effect commits nothing (no spurious batch roundtrip)", async () => {
    const stub = stubD1();
    await commitEffectBatch(stub.database, { statements: [], outboxMessages: [] }, { now: NOW });
    expect(stub.batches).toHaveLength(0);
  });

  it("a failed batch propagates and records nothing (all-or-nothing)", async () => {
    const stub = stubD1();
    stub.failBatchWith(new Error("D1_ERROR: UNIQUE constraint failed: idempotency_key.key"));
    const business = stub.database.prepare("UPDATE a SET b = 1");
    await expect(
      commitEffectBatch(
        stub.database,
        { statements: [business], outboxMessages: [] },
        { idempotencyRecord: completedRecord(), now: NOW },
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    expect(stub.executed.filter((entry) => entry.sql.includes("UPDATE a"))).toHaveLength(0);
  });
});
