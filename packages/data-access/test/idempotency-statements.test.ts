import { describe, expect, it } from "vitest";
import {
  insertCompletedIdempotencyRecordStatement,
  isIdempotencyKeyConflict,
  purgeExpiredIdempotencyRecordsStatement,
  selectIdempotencyRecordStatement,
} from "../src/idempotency-statements.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { stubD1 } from "./support/stub-d1.ts";

describe("idempotency statement builders", () => {
  it("select binds the client key", () => {
    const stub = stubD1();
    const statement = selectIdempotencyRecordStatement(stub.database, "client-key-1");
    expect(statement.sql).toContain("FROM idempotency_key WHERE key = ?1");
    expect(statement.bindings).toEqual(["client-key-1"]);
  });

  it("insert writes a completed record with the captured response", () => {
    const stub = stubD1();
    const id = newIdentifier("idempotencyRecord");
    const statement = insertCompletedIdempotencyRecordStatement(stub.database, {
      id,
      key: "client-key-1",
      fingerprint: "f".repeat(64),
      responseCode: 201,
      responseBody: '{"id":"inv_x"}',
      createdAt: "2026-06-09T00:00:00.000Z",
    });
    expect(statement.sql).toContain("INSERT INTO idempotency_key");
    expect(statement.sql).toContain("'completed'");
    expect(statement.bindings).toEqual([
      id,
      "client-key-1",
      "f".repeat(64),
      201,
      '{"id":"inv_x"}',
      "2026-06-09T00:00:00.000Z",
    ]);
  });

  it("purge deletes records older than the cutoff (TTL is ephemeral dedup state)", () => {
    const stub = stubD1();
    const statement = purgeExpiredIdempotencyRecordsStatement(stub.database, "2026-06-08T00:00:00.000Z");
    expect(statement.sql).toContain("DELETE FROM idempotency_key WHERE created_at < ?1");
    expect(statement.bindings).toEqual(["2026-06-08T00:00:00.000Z"]);
  });
});

describe("isIdempotencyKeyConflict", () => {
  it("matches the D1/SQLite UNIQUE violation for the key column", () => {
    expect(
      isIdempotencyKeyConflict(new Error("D1_ERROR: UNIQUE constraint failed: idempotency_key.key")),
    ).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isIdempotencyKeyConflict(new Error("D1_ERROR: no such table: idempotency_key"))).toBe(false);
    expect(isIdempotencyKeyConflict(new Error("UNIQUE constraint failed: outbox.id"))).toBe(false);
    expect(isIdempotencyKeyConflict("not an error")).toBe(false);
  });
});
