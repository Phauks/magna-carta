import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  commitEffectBatch,
  composeEffectBatch,
  EffectBatchTooLargeError,
  MAX_BATCH_STATEMENTS,
} from "../src/effect-batch.ts";
import { stubD1 } from "./support/stub-d1.ts";

const NOW = () => "2026-06-09T00:00:00.000Z";

function completedRecord() {
  return {
    id: newIdentifier("idempotencyRecord"),
    key: "client-key-1",
    fingerprint: "f".repeat(64),
    responseCode: 201,
    responseBody: '{"id":"invoice_x"}',
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

  it("composes a batch at the ceiling without an argument-count limit", () => {
    // The composer used to spread its statement list into `push`, which passes every element as a
    // separate ARGUMENT and blows the engine stack somewhere in the low hundreds of thousands — a
    // limit that moved with how deep the caller already was, so the same effect could compose on one
    // path and abort on another. A batch AT the stated ceiling must compose, every time.
    const stub = stubD1();
    const statements = Array.from({ length: MAX_BATCH_STATEMENTS }, (_, index) =>
      stub.database.prepare("INSERT INTO a (id) VALUES (?1)").bind(index),
    );
    const composed = composeEffectBatch(
      stub.database,
      { statements, outboxMessages: [] },
      { now: NOW },
    );
    expect(composed).toHaveLength(MAX_BATCH_STATEMENTS);
  });

  it("refuses a batch past the ceiling, and the refusal says what to do instead", () => {
    const stub = stubD1();
    const statements = Array.from({ length: MAX_BATCH_STATEMENTS + 1 }, (_, index) =>
      stub.database.prepare("INSERT INTO a (id) VALUES (?1)").bind(index),
    );
    let thrown: unknown;
    try {
      composeEffectBatch(stub.database, { statements, outboxMessages: [] }, { now: NOW });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EffectBatchTooLargeError);
    const error = thrown as EffectBatchTooLargeError;
    expect(error.statementCount).toBe(MAX_BATCH_STATEMENTS + 1);
    expect(error.maximumStatementCount).toBe(MAX_BATCH_STATEMENTS);
    // Naming the remedy is the point of the refusal: splitting the batch would trade the ceiling for
    // a partially committed write, so the message has to point at bounding the effect instead.
    expect(error.message).toContain("bound the effect");
    expect(error.message).toContain("never to split the batch");
  });

  it("counts the idempotency record and the outbox rows against the ceiling", () => {
    // They ride the same transaction as the business statements, so a ceiling that ignored them would
    // let a batch exceed it by exactly the rows the composer itself adds.
    const stub = stubD1();
    const statements = Array.from({ length: MAX_BATCH_STATEMENTS }, () =>
      stub.database.prepare("INSERT INTO a (id) VALUES (1)"),
    );
    expect(() =>
      composeEffectBatch(
        stub.database,
        { statements, outboxMessages: [] },
        { idempotencyRecord: completedRecord(), now: NOW },
      ),
    ).toThrow(EffectBatchTooLargeError);
    expect(() =>
      composeEffectBatch(
        stub.database,
        { statements, outboxMessages: [{ topic: "probe", payload: {} }] },
        { now: NOW },
      ),
    ).toThrow(EffectBatchTooLargeError);
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
